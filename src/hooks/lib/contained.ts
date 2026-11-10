import * as fs from "node:fs";
import * as path from "node:path";
import { isSensitiveFile } from "./config.ts";

// ── Containment gate: one place that decides whether a project path may be read ──
//
// Why this module exists
//   A lexical check (`path.relative` has no leading `..`) says nothing about where a path
//   really points. A symlink inside the project, `docs/notes.md -> ~/private/notes.md`, or a
//   symlinked directory, `linked/ -> /elsewhere`, passes every lexical check, and both
//   `fs.statSync` and `fs.readFileSync` follow it. Before this gate, the indexer read such a
//   target and stored its description, size and symbol names in anatomy-index.json, and the
//   sensitive-file filter judged the link's name, not the target's.
//
// What it guarantees, for a path it admits
//   1. The resolved real path lies inside the real project root (symlinks anywhere in the path,
//      the final component or any ancestor, are resolved first).
//   2. Neither the requested basename nor the resolved basename is sensitive, so a link named
//      `readme.md` pointing at `id_rsa` inside the project is refused too.
//   3. What is read is a regular file within `maxBytes`, checked with fstat on the same file
//      descriptor that is then read. A file swapped between the check and the open cannot be
//      substituted: the open uses O_NOFOLLOW on the already-resolved path, and the fstat
//      describes exactly what is read.
//
// What it does not do
//   It does not apply the index's name gates (binary, lockfile, excludes, hidden paths); callers
//   still run `isIndexableName` first. It does not defend against a hostile process that can
//   rewrite files inside the project between the gate and a later, separate read.
//
// Constraints: this file lives under src/hooks/lib/, which is vendored into each project, so it
// imports only `node:` modules and siblings (tests/hooks-imports.test.ts enforces it). Like every
// hook path it never throws: refusal is `null`.
//
// Added in the private evaluation copy (aegis/safety-fixes); see ATTRIBUTION.md.

/** The project root's real path, or null when it cannot be resolved. */
export function realRoot(rootDir: string): string | null {
  try {
    return fs.realpathSync(rootDir);
  } catch {
    return null;
  }
}

/** True when `real` is `root` itself or lies under it. Both must already be real paths. */
export function isWithin(root: string, real: string): boolean {
  return real === root || real.startsWith(root + path.sep);
}

/**
 * The real path of `relPath` under `rootDir` when the gate admits it, else null.
 * Cheap enough for a walk filter: one realpath and one stat, no read.
 */
export function admittedPath(
  rootDir: string,
  relPath: string,
  maxBytes: number,
  root: string | null = realRoot(rootDir),
): string | null {
  if (root === null) return null;
  let real: string;
  try {
    real = fs.realpathSync(path.join(rootDir, relPath));
  } catch {
    return null;
  }
  if (!isWithin(root, real) || real === root) return null;
  if (isSensitiveFile(path.basename(relPath)) || isSensitiveFile(path.basename(real))) return null;
  try {
    const st = fs.statSync(real);
    if (!st.isFile() || st.size > maxBytes) return null;
  } catch {
    return null;
  }
  return real;
}

/** An admitted file's bytes and stat, read through one descriptor. */
export interface AdmittedRead {
  real: string;
  buf: Buffer;
  stat: fs.Stats;
}

/**
 * Read `relPath` under `rootDir` only if the gate admits it. Null on refusal or any I/O error.
 * `realRootPath` lets a caller that reads many files resolve the root once.
 */
export function readAdmitted(
  rootDir: string,
  relPath: string,
  maxBytes: number,
  realRootPath: string | null = realRoot(rootDir),
): AdmittedRead | null {
  const real = admittedPath(rootDir, relPath, maxBytes, realRootPath);
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
