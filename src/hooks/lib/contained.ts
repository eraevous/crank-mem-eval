import * as fs from "node:fs";
import * as path from "node:path";
import { isSensitiveFile } from "./config.ts";

// ── Containment gate: whether a project path may be read for its facts ──
//
// Why this module exists
//   A lexical check (the path sits under the owning root by name) says nothing about where the
//   path really points. A symlink inside the project, `docs/notes.md -> ~/private/notes.md`, or a
//   symlinked directory, `linked/ -> /elsewhere`, passes every lexical check, and both
//   `fs.statSync` and `fs.readFileSync` follow it. Without this gate, a write to such a path put
//   the target's description and size into code.db, and the sensitive-file filter judged the
//   link's name, not the target's.
//
// What it guarantees, for a path it admits
//   1. The resolved real path lies inside the real project root (symlinks anywhere in the path,
//      the final component or any ancestor, are resolved first).
//   2. Neither the requested basename nor the resolved basename is sensitive, so a link named
//      `readme.md` pointing at `id_rsa` inside the project is refused too.
//   3. What is read is a regular file within `maxBytes`, checked with fstat on the descriptor
//      that is then read, opened with O_NOFOLLOW on the already-resolved path.
//
// What it does not do
//   It does not apply the index's name gates; `fileFacts` runs `isIndexableName` first. It does
//   not defend against a process that rewrites files inside the project between this read and a
//   later, separate one.
//
// Lives under src/hooks/lib/, so it imports only `node:` modules and siblings, and it never
// throws: refusal is `null`.
//
// Our 3aeb6e0 (R-index-containment@1), rebuilt on v0.16's fileFacts; see ATTRIBUTION.md.

/** An admitted file's real path, bytes and stat, read through one descriptor. */
export interface AdmittedRead {
  real: string;
  buf: Buffer;
  stat: fs.Stats;
}

function admittedPath(rootDir: string, relPath: string): string | null {
  let root: string;
  let real: string;
  try {
    root = fs.realpathSync(rootDir);
    real = fs.realpathSync(path.join(rootDir, relPath));
  } catch {
    return null;
  }
  if (!real.startsWith(root + path.sep)) return null;
  if (isSensitiveFile(path.basename(relPath)) || isSensitiveFile(path.basename(real))) return null;
  return real;
}

/** Reads `relPath` under `rootDir` only if the gate admits it. Null on refusal or any I/O error. */
export function readAdmitted(
  rootDir: string,
  relPath: string,
  maxBytes: number,
): AdmittedRead | null {
  const real = admittedPath(rootDir, relPath);
  if (real === null) return null;
  let fd: number;
  try {
    // O_NOFOLLOW: `real` is fully resolved, so a symlink here means the file was swapped.
    fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const buf = Buffer.alloc(stat.size);
    let off = 0;
    while (off < stat.size) {
      const n = fs.readSync(fd, buf, off, stat.size - off, off);
      if (n === 0) break;
      off += n;
    }
    return { real, buf: off === stat.size ? buf : buf.subarray(0, off), stat };
  } catch {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
  }
}
