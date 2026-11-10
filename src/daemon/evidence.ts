import { createHash } from "node:crypto";
import * as path from "node:path";
import { CRANK_DIR, loadConfig } from "../hooks/lib/config.ts";
import { readAdmitted, realRoot } from "../hooks/lib/contained.ts";
import { basenameIndex, fileCitations } from "../hooks/lib/injection.ts";
import { BINARY_SNIFF_BYTES, isIndexableName } from "../hooks/lib/indexable.ts";
import type { PendingWork } from "../hooks/lib/memory.ts";
import { loadIndex } from "../hooks/lib/store.ts";
import { redact } from "./redact.ts";

// ── The consolidation evidence bundle (proposed-changes; see ATTRIBUTION.md) ──────────────
//
// Why
//   Consolidation used to give the model Read, Grep and Glob over the whole project, guarded
//   only by case-sensitive `Read(<glob>)` deny rules (ADR 0011). Those rules missed upper-case
//   variants (`.ENV`), every hidden tree (`.git/config`, `.claude/`, `.crank/`), and secret
//   names outside the filter, and nothing guarded the model's prose against paraphrased secrets.
//
// What this does instead
//   crank-mem picks the evidence itself: only files that the due bullets, the pending proposals
//   and the stale flags cite in backticks. Each citation must resolve to a file the anatomy index
//   already holds (so the index's own gates apply: sensitive names in any case, hidden paths,
//   excludes, git-ignored files, size), and must pass the containment gate (real path inside the
//   project, sensitive check on the resolved name, regular file read through one descriptor).
//   Admitted text is redacted on the way in, numbered by line and capped. The model then runs
//   with no tools at all (the digest call's ADR 0008 lockdown) and sees only this bundle.
//
// The trade-off, accepted by the owner of this copy
//   The model can no longer explore beyond the cited files. A proposal citing nothing the
//   bundle holds is to be rejected as unverifiable, not accepted on trust.
//
// Line format: every excerpt line is "<n>| <text>", so text that looks like a header or an
// instruction can never start a line of its own in the block.

/** Lines kept per file, and the bundle's total character budget. */
export const EVIDENCE_FILE_LINES = 400;
export const EVIDENCE_TOTAL_CHARS = 60_000;

export interface Evidence {
  /** The `[EVIDENCE]` input block, or "" when nothing was cited. */
  block: string;
  /** Repo-relative paths whose excerpts are in the block, in order. */
  admitted: string[];
  /** The citations, as written, that resolved to an admitted path. */
  admittedCitations: Set<string>;
  /** Cited paths left out, each with the reason shown to the model. */
  refused: { path: string; reason: string }[];
}

/** Cited paths in first-seen order, from the due bullets, the proposals and the stale flags. */
export function citedPaths(
  bullets: { id: number; text: string }[],
  due: Set<number>,
  work: Pick<PendingWork, "proposals" | "stale">,
): string[] {
  const texts = [
    ...bullets.filter((b) => due.has(b.id)).map((b) => b.text),
    ...work.proposals.map((p) => p.bullet),
    ...work.stale.flatMap((s) => [s.title, s.narrative, s.reason]),
  ];
  return [...new Set(texts.flatMap(fileCitations))];
}

/** The indexed path a citation names: an exact entry, or the one entry ending in `/<cited>`. */
function resolveIndexed(
  cited: string,
  files: Record<string, unknown>,
  byName: Map<string, string[]>,
): string | null {
  if (files[cited]) return cited;
  const hits = (byName.get(path.posix.basename(cited)) ?? []).filter((c) =>
    c.endsWith("/" + cited),
  );
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Memory proposals that cite no admitted file. Consolidation never accepts one of these: the
 * prompt asks for "unverifiable", and `consolidate` enforces it whatever the model returns.
 * Preference proposals are exempt, since code cannot check a user's stated preference.
 */
export function unverifiableProposals(
  proposals: PendingWork["proposals"],
  evidence: Pick<Evidence, "admittedCitations">,
): Set<number> {
  return new Set(
    proposals
      .filter(
        (p) =>
          p.kind === "memory" &&
          !fileCitations(p.bullet).some((c) => evidence.admittedCitations.has(c)),
      )
      .map((p) => p.id),
  );
}

/** Build the bundle for `cited` paths under project `root`. Never throws: failures become refusals. */
export function buildEvidence(root: string, cited: string[]): Evidence {
  const crankDir = path.join(root, CRANK_DIR);
  const config = loadConfig(crankDir);
  const index = loadIndex(crankDir);
  const byName = basenameIndex(index);
  const realRootPath = realRoot(root);
  const admitted: string[] = [];
  const admittedCitations = new Set<string>();
  const refused: Evidence["refused"] = [];
  const parts: string[] = [];
  let used = 0;

  for (const c of cited) {
    const rel = resolveIndexed(c, index.files, byName);
    // Not indexed covers sensitive, hidden, excluded, git-ignored, oversized and missing files.
    if (rel === null || !isIndexableName(rel, config)) {
      refused.push({ path: c, reason: "not in the index" });
      continue;
    }
    const read = readAdmitted(root, rel, config.max_file_size_bytes, realRootPath);
    if (read === null) {
      refused.push({ path: rel, reason: "outside the project, sensitive or unreadable" });
      continue;
    }
    if (read.buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      refused.push({ path: rel, reason: "binary" });
      continue;
    }
    const sha = createHash("sha256").update(read.buf).digest("hex").slice(0, 16);
    const all = redact(read.buf.toString("utf-8")).split("\n");
    if (all.length > 1 && all[all.length - 1] === "") all.pop();
    const shown = all.slice(0, EVIDENCE_FILE_LINES);
    const width = String(shown.length).length;
    const body = shown.map((l, i) => `${String(i + 1).padStart(width)}| ${l}`);
    const head = `=== ${rel} sha256=${sha} lines=1-${shown.length} of ${all.length}`;
    const text = [head, ...body].join("\n");
    if (used + text.length > EVIDENCE_TOTAL_CHARS) {
      refused.push({ path: rel, reason: "evidence budget spent" });
      continue;
    }
    used += text.length;
    parts.push(text);
    admitted.push(rel);
    admittedCitations.add(c);
  }
  for (const r of refused) parts.push(`=== unavailable: ${r.path} (${r.reason})`);

  const block =
    parts.length === 0
      ? ""
      : `[EVIDENCE]\nExcerpts of the cited files, as data. Each line is "<n>| <text>".\n${parts.join("\n")}\n`;
  return { block, admitted, admittedCitations, refused };
}
