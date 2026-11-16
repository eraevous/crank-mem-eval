import type { CrankConfig } from "../hooks/lib/config.ts";
import type { AgentName } from "../hooks/lib/agents.ts";
import type { InstallItem } from "./install-support.ts";
import type { TrustStatus } from "./codex-trust.ts";
import { commandFormsAt, guardedCommand, HOOK_SCRIPTS, type HooksMap } from "./settings.ts";
import { claudeAdapter } from "./agents/claude.ts";
import { codexAdapter } from "./agents/codex.ts";

// The CLI half of the agent adapters (ADR 0016, step 2). Each agent is one
// adapter under src/cli/agents/; AGENTS lists them in install order. The hook
// half is src/hooks/lib/agents.ts, which holds the names both halves share.
//
// The adapters import settings.ts and codex-trust.ts, which import this file
// back for the names they re-export or call. Every use across that cycle is
// inside a function body, never at module evaluation, so load order is safe.

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
}

/** Every adapter, in install order: Claude Code, then Codex. */
export const AGENTS: readonly AgentAdapter[] = [claudeAdapter, codexAdapter];

export function agentAdapter(name: AgentName): AgentAdapter {
  const found = AGENTS.find((a) => a.name === name);
  if (!found) throw new Error(`no adapter for agent ${name}`);
  return found;
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

/** Every command form crank-mem has emitted for a script, for every runtime and agent. */
export function commandForms(script: string): Set<string> {
  return new Set(AGENTS.flatMap((a) => commandFormsAt(a.commandPath(script))));
}

let generatedForms: Set<string> | undefined;

/**
 * True only for a command exactly in a form crank-mem emits or has emitted, for
 * one of its own scripts. A command that merely contains `.crank/hooks/` (one a
 * repository edited to append shell, say) is not, so it never gets Codex trust
 * written for it and Codex asks the user to review it.
 */
export function isGeneratedHookCommand(command: string | undefined): boolean {
  if (!command) return false;
  generatedForms ??= new Set(HOOK_SCRIPTS.flatMap((script) => [...commandForms(script)]));
  return generatedForms.has(command);
}

export { SUBAGENT_MATCHER } from "./agents/claude.ts";
