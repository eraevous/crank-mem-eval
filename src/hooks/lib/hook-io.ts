import * as fs from "node:fs";
import * as path from "node:path";
import { CRANK_DIR, errorMessage, isSensitiveFile } from "./config.ts";
import { flushDebug } from "./debug.ts";
import { agentFor } from "./payload-adapters.ts";

// Hook I/O helpers. Hooks are advisory-only: they must never fail the tool
// call, so payload parsing degrades to null and callers exit 0.

/** Read all of stdin (hooks receive one JSON payload then EOF). */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

export interface HookPayload {
  hook_event_name?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  source?: string;
  [key: string]: unknown;
}

export function parsePayload(raw: string): HookPayload | null {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as HookPayload) : null;
  } catch {
    return null;
  }
}

/** True when Codex sent the payload (ADR 0016: the Codex payload adapter decides). */
export function isCodexPayload(payload: HookPayload): boolean {
  return agentFor(payload).name === "codex";
}

/**
 * Locate the project root, the dir holding `.crank/config.json`, by walking up from
 * `cwd`. Returns null when crank-mem isn't installed here.
 */
export function findProjectRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, CRANK_DIR, "config.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `p` (absolute, or relative to `cwd`) as a `/`-separated path under `root`; null for the root itself or outside it. */
export function repoRelative(root: string, cwd: string, p: string): string | null {
  const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
  const r = path.relative(root, abs);
  if (!r || r.startsWith("..") || path.isAbsolute(r)) return null;
  return r.split(path.sep).join("/");
}

/** The paths memory may record: repo-relative, never sensitive, deduped in input order. */
export function memoryPaths(root: string, cwd: string, paths: string[]): string[] {
  const kept = new Set<string>();
  for (const p of paths) {
    const r = repoRelative(root, cwd, p);
    if (r !== null && !isSensitiveFile(path.posix.basename(r))) kept.add(r);
  }
  return [...kept];
}

/** Whether `rel` under `root` is a regular file now, following symlinks; false on any error. */
export function isProjectFile(root: string, rel: string): boolean {
  try {
    return fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

/** Emit model-visible context via hookSpecificOutput (both agents). */
export function emitAdditionalContext(hookEventName: string, context: string): void {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: context } }),
  );
}

/**
 * Run a hook's entry point under the advisory-only contract: errors are
 * reported to stderr (human/debug-only) and the process always exits 0.
 *
 * Also the single timing/outcome seam for every hook: one debug record per run,
 * carrying the full stack that the stderr line deliberately omits.
 */
export async function runAdvisoryHook(name: string, main: () => Promise<void>): Promise<void> {
  const started = Date.now();
  let error: unknown;
  try {
    await main();
  } catch (err) {
    error = err;
    console.error(`crank-mem ${name}: ${errorMessage(err)}`);
  }
  flushDebug({
    hook: name,
    ms: Date.now() - started,
    ok: error === undefined,
    ...(error !== undefined && {
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    }),
  });
  process.exit(0);
}
