import * as path from "node:path";
import type { AgentName } from "./agents.ts";
import { parseApplyPatch } from "./apply-patch.ts";
import type { HookPayload } from "./hook-io.ts";
import { shellReadPaths } from "./shell-reads.ts";

// The hook half of the agent adapters (ADR 0016, step 3). Vendored with the
// hooks, so it imports only `node:` modules and files under src/hooks/.
//
// Two questions, answered separately so neither changes behavior:
// - which agent sent a payload: the first adapter, in registry order, whose
//   `owns` matches (Codex before Claude; Claude is the fallback);
// - which paths a write or read carries: the first adapter whose tool it is,
//   whoever sent it. The tool, not the agent, has always decided this, so a
//   payload whose agent markers are missing is still indexed.
// Path resolution, the containment gate and the `.crank/` skip stay in the hooks.

export interface RawWrite {
  path: string;
  deleted: boolean;
}

export interface PayloadAdapter {
  name: AgentName;
  /** True when this agent sent the payload. */
  owns(payload: HookPayload): boolean;
  /** The raw paths a write tool names; null when the tool is not this agent's write tool. */
  writes(payload: HookPayload): RawWrite[] | null;
  /** The raw paths a read tool names; null when the tool is not this agent's read tool. */
  reads(payload: HookPayload): string[] | null;
}

/** What a hook needs from one payload, whichever agent sent it. */
export interface HookEvent {
  agent: AgentName;
  event: string | null;
  cwd: string | null;
  tool: string | null;
  /** null: no adapter handles this tool as a write. Empty: a write tool naming no path. */
  writes: RawWrite[] | null;
  reads: string[];
}

function input(payload: HookPayload): Record<string, unknown> {
  return payload.tool_input ?? {};
}

const claude: PayloadAdapter = {
  name: "claude",
  owns: () => true,
  writes(payload) {
    const t = payload.tool_name;
    if (t !== "Write" && t !== "Edit" && t !== "MultiEdit") return null;
    const p = input(payload).file_path;
    return typeof p === "string" ? [{ path: p, deleted: false }] : [];
  },
  reads(payload) {
    const i = input(payload);
    if (payload.tool_name === "Read") return typeof i.file_path === "string" ? [i.file_path] : [];
    if (payload.tool_name === "Bash")
      return typeof i.command === "string" ? shellReadPaths(i.command) : [];
    return null;
  },
};

const codex: PayloadAdapter = {
  name: "codex",
  /**
   * Codex tool payloads carry a turn_id, but its SessionStart does not (ADR 0007),
   * so also match the Codex transcript name, `rollout-<ts>-<uuid>.jsonl` (ADR 0006).
   * Claude carries neither.
   */
  owns(payload) {
    if (typeof payload.turn_id === "string") return true;
    return (
      typeof payload.transcript_path === "string" &&
      path.basename(payload.transcript_path).startsWith("rollout-")
    );
  },
  writes(payload) {
    if (payload.tool_name !== "apply_patch") return null;
    const cmd = input(payload).command;
    return typeof cmd === "string" ? parseApplyPatch(cmd) : [];
  },
  // Codex has no Read tool; its reads arrive as Bash (ADR 0003), which the Claude
  // adapter answers by tool. post-read is wired for Claude only (ADR 0009).
  reads: () => null,
};

/** Registry order for ownership: the last adapter is the fallback. */
export const PAYLOAD_ADAPTERS: readonly PayloadAdapter[] = [codex, claude];

export function agentFor(payload: HookPayload): PayloadAdapter {
  return PAYLOAD_ADAPTERS.find((a) => a.owns(payload)) ?? claude;
}

/** The owner's answer first, then every other adapter's, in registry order. */
function firstAnswer<T>(owner: PayloadAdapter, ask: (a: PayloadAdapter) => T | null): T | null {
  for (const a of [owner, ...PAYLOAD_ADAPTERS.filter((x) => x !== owner)]) {
    const got = ask(a);
    if (got !== null) return got;
  }
  return null;
}

export function hookEvent(payload: HookPayload): HookEvent {
  const owner = agentFor(payload);
  return {
    agent: owner.name,
    event: typeof payload.hook_event_name === "string" ? payload.hook_event_name : null,
    cwd: typeof payload.cwd === "string" ? payload.cwd : null,
    tool: typeof payload.tool_name === "string" ? payload.tool_name : null,
    writes: firstAnswer(owner, (a) => a.writes(payload)),
    reads: firstAnswer(owner, (a) => a.reads(payload)) ?? [],
  };
}
