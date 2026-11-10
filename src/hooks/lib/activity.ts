import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { CrankConfig } from "./config.ts";
import { activePaths, type AnatomyIndex, type Churn, type FileEntry } from "./store.ts";
import { debugEvent } from "./debug.ts";
import { isIndexableName } from "./indexable.ts";

// Git listing and churn-driven index activity: the walk's git listing, the churn
// cache and the write pins it settles.

// A large repo's ls-files listing can pass the 1 MiB default maxBuffer.
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
// walkProject runs before the refresh deadline is checked, so git gets its own.
const GIT_TIMEOUT_MS = 500;

/** Run git in rootDir; on failure, the error code or exit status instead of stdout. Never throws. */
export function runGit(
  rootDir: string,
  args: string[],
  timeoutMs: number,
): { stdout: string } | { error: string } {
  if (timeoutMs <= 0) return { error: "budget spent" };
  const res = spawnSync("git", ["--no-optional-locks", ...args], {
    cwd: rootDir,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (res.error) return { error: (res.error as NodeJS.ErrnoException).code ?? res.error.message };
  if (res.status !== 0) return { error: `exit ${res.status}` };
  return { stdout: res.stdout };
}

/**
 * True when `rootDir` or any ancestor holds `.git` (a directory, or a file for worktrees and
 * submodules). A filesystem walk, not a git call, so it still answers when git itself fails.
 *
 * Added in aegis/safety-fixes (see ATTRIBUTION.md): the old check looked for `.git` in
 * `rootDir` only, so a project rooted in a monorepo subdirectory was treated as "not a repo"
 * and walked without its .gitignore.
 */
export function insideGitRepo(rootDir: string): boolean {
  let dir = path.resolve(rootDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * Tracked plus untracked-but-not-ignored paths under `rootDir`, relative to it; null outside
 * any git repository; "failed" when `rootDir` is inside a repository but git fails.
 *
 * Run from `rootDir`, `git ls-files` lists only that subtree, relative to it, and applies every
 * applicable ignore file, the enclosing repository's included. Callers must treat "failed" as
 * "do not know what is ignored" and keep what they have rather than walk unfiltered.
 * Submodules list as one path (a directory, dropped by the isFile check), so their contents are
 * never indexed. An unmerged path lists once per conflict stage, so the listing is deduplicated.
 */
export function gitListing(rootDir: string): string[] | null | "failed" {
  if (!insideGitRepo(rootDir)) return null;
  const r = runGit(rootDir, ["ls-files", "-co", "--exclude-standard", "-z"], GIT_TIMEOUT_MS);
  if ("error" in r) {
    debugEvent("walk-refused", { reason: r.error });
    return "failed";
  }
  return [...new Set(r.stdout.split("\0").filter(Boolean))];
}

const CHURN_COMMITS = 300;
// Bulk commits such as vendor syncs and mass renames say nothing about where
// work happens, and a few of them can make most of a repo's file touches.
const CHURN_BULK_FILES = 50;
const CHURN_KEEP = 100;

/**
 * The indexable paths changed most often in the last CHURN_COMMITS commits,
 * skipping bulk commits. Reuses `cached` while HEAD has not moved; undefined
 * outside git, before the first commit, or when git fails.
 */
function churnFor(
  rootDir: string,
  config: CrankConfig,
  cached: Churn | undefined,
): Churn | undefined {
  if (!insideGitRepo(rootDir)) return undefined;
  const rev = runGit(rootDir, ["rev-parse", "HEAD"], GIT_TIMEOUT_MS);
  if ("error" in rev) {
    debugEvent("churn-skipped", { reason: rev.error });
    return undefined;
  }
  const head = rev.stdout.trim();
  if (cached?.head === head) return cached;
  // One \x1e record per commit, then "\0\n" and NUL-separated paths.
  const log = runGit(
    rootDir,
    // --relative: paths relative to rootDir and limited to it, so a monorepo subdirectory
    // project counts only its own files, under the names its index uses.
    ["log", `-n${CHURN_COMMITS}`, "-z", "--name-only", "--relative", "--format=%x1e"],
    GIT_TIMEOUT_MS,
  );
  if ("error" in log) {
    debugEvent("churn-skipped", { reason: log.error });
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const record of log.stdout.split("\x1e")) {
    const paths = record
      .split("\0")
      .map((p) => p.replace(/^\n/, ""))
      .filter(Boolean);
    if (paths.length > CHURN_BULK_FILES) continue;
    for (const p of paths) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const paths = [...counts]
    .filter(([rel]) => isIndexableName(rel, config))
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, CHURN_KEEP)
    .map(([rel]) => rel);
  return { head, paths };
}

/**
 * Refresh the churn cache, unpin files the churn list now carries or that fall
 * past MAX_PINS, and return the paths the walk takes first.
 */
export function updateActivity(
  rootDir: string,
  config: CrankConfig,
  index: AnatomyIndex,
): string[] {
  const churn = churnFor(rootDir, config, index.meta.churn);
  if (churn) index.meta.churn = churn;
  else delete index.meta.churn;
  const inChurn = new Set(churn?.paths);
  for (const [rel, entry] of Object.entries(index.files))
    if (inChurn.has(rel)) delete entry.writeCount;
  const active = activePaths(index);
  const kept = new Set(active);
  for (const [rel, entry] of Object.entries(index.files))
    if (!kept.has(rel)) delete entry.writeCount;
  return active;
}

/** A fresh entry keeps the write pin of the entry it replaces. */
export function keepPin(entry: FileEntry, prior: FileEntry | undefined): FileEntry {
  if (prior?.writeCount) entry.writeCount = prior.writeCount;
  return entry;
}
