import type { CrankConfig } from "../hooks/lib/config.ts";
import type { AgentName } from "../hooks/lib/agents.ts";
import type { InstallItem } from "./install-support.ts";
import type { TrustStatus } from "./codex-trust.ts";
import type { Position } from "../hooks/lib/memory.ts";
import type { Distilled } from "../daemon/transcript.ts";
import { guardedCommand, type HooksMap } from "./settings.ts";
import { claudeAdapter } from "./agents/claude.ts";
import { codexAdapter } from "./agents/codex.ts";

// The CLI half of the agent adapters (ADR 0016, step 2). Each agent is one
// adapter under src/cli/agents/; AGENTS lists them in install order. The hook
// half is src/hooks/lib/agents.ts, which holds the names both halves share.
//
// Nothing an adapter imports reaches this file: the adapters take the
// settings-file helpers and command forms from settings.ts, which imports
// no adapter, so each adapter loads on its own in a fresh process
// (tests/module-load.test.ts).

export interface AgentAdapter {
  name: AgentName;
  /** For report lines: "Claude Code", "Codex". */
  label: string;
  /** The hook entries crank-mem wires for this agent. */
  hooks(runtime: CrankConfig["runtime"]): HooksMap;
  /** The script path as this agent's hook commands spell it. */
  commandPath(script: string): string;
  /** Whether the recorded config wires this agent (each reads its own legacy key). */
  enabled(config: CrankConfig): boolean;
  /** Wire (apply), repair and remove this agent's settings files. */
  wiring: InstallItem;
  /** The optional trust step. Only the adapter's own `wiring` writes or removes trust. */
  trust?: {
    status(root: string): TrustStatus;
    write(root: string, backup: (file: string) => void): string[];
    remove(root: string): string[];
  };
  /**
   * Distill this agent's session transcript for a digest. Only Claude supplies
   * a reader; an entry naming any other agent keeps the legacy fallback to
   * Claude's (see transcriptReader).
   */
  readTranscript?(file: string, after: Position | null, maxChars: number): Distilled;
}

/** Every adapter, in install order: Claude Code, then Codex. */
export const AGENTS: readonly AgentAdapter[] = [claudeAdapter, codexAdapter];

export function agentAdapter(name: AgentName): AgentAdapter {
  const found = AGENTS.find((a) => a.name === name);
  if (!found) throw new Error(`no adapter for agent ${name}`);
  return found;
}

/**
 * The transcript reader for a spool entry's `agent` field. An agent without a
 * reader, or a missing or unknown name, gets Claude's: the job has always read
 * every entry as a Claude transcript, and step 4 of ADR 0016 keeps that.
 */
export function transcriptReader(agent: unknown): NonNullable<AgentAdapter["readTranscript"]> {
  const own = AGENTS.find((a) => a.name === agent)?.readTranscript;
  const reader = own ?? claudeAdapter.readTranscript;
  if (!reader) throw new Error("the Claude adapter has no transcript reader");
  return reader;
}

/** The hook entries crank-mem wires, per agent. */
export function crankHooks(runtime: CrankConfig["runtime"], agent: AgentName): HooksMap {
  return agentAdapter(agent).hooks(runtime);
}

export function hookCommand(
  runtime: CrankConfig["runtime"],
  script: string,
  agent: AgentName,
): string {
  return guardedCommand(runtime, agentAdapter(agent).commandPath(script));
}

// Command forms need every agent's command path but no adapter: settings.ts
// owns them, and these re-exports keep the names callers import from here.
export { commandForms, isGeneratedHookCommand } from "./settings.ts";

export { SUBAGENT_MATCHER } from "./agents/claude.ts";
