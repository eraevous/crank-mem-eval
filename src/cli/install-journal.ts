import * as fs from "node:fs";
import * as path from "node:path";

// ── The init journal (proposed-changes; see ATTRIBUTION.md) ─────────────────────────────────
//
// `init` writes this file before its first change and deletes it once everything is in place.
// A journal left behind therefore means an init was interrupted (killed, crashed, a disk filled):
// `init` and `doctor` find it and point to `init --resume` or `init --rollback`, instead of the
// old behaviour, where an interrupted init left a half-wired project and the next `init` refused.
// The file is under .crank/, which the allowlist .gitignore keeps out of git.

export const JOURNAL_FILE = "install-journal.json";

export interface InitJournal {
  /** When the interrupted init started, ISO 8601. */
  startedAt: string;
  /** The backup directory that init's writers recorded their originals in. */
  backupDir: string;
  /** The crank-mem version that started it. */
  version: string;
}

export function journalPath(crankDir: string): string {
  return path.join(crankDir, JOURNAL_FILE);
}

export function writeJournal(crankDir: string, j: InitJournal): void {
  fs.writeFileSync(journalPath(crankDir), JSON.stringify(j, null, 2) + "\n");
}

/** The journal of an interrupted init, or null when there is none or it cannot be read. */
export function readJournal(crankDir: string): InitJournal | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(journalPath(crankDir), "utf-8"));
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.startedAt !== "string" || typeof r.backupDir !== "string") return null;
    return {
      startedAt: r.startedAt,
      backupDir: r.backupDir,
      version: typeof r.version === "string" ? r.version : "unknown",
    };
  } catch {
    return null;
  }
}

/** True when a journal file exists at all, readable or not. */
export function hasJournal(crankDir: string): boolean {
  return fs.existsSync(journalPath(crankDir));
}

export function clearJournal(crankDir: string): void {
  fs.rmSync(journalPath(crankDir), { force: true });
}
