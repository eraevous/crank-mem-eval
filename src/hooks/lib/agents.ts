// The agent registry (ADR 0016, step 1): the one list of agents crank-mem wires.
// Lives under src/hooks/lib/ and imports nothing, so the vendored hooks and the
// CLI share it. Order is install order: Claude Code first, then Codex.

export const AGENT_NAMES = ["claude", "codex"] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

/** `--agents` alias for every agent in the registry. */
export const ALL_AGENTS = "both";

/** What `--agents` accepts: each registered name, then the all-agents alias. */
export function agentChoices(): string[] {
  return [...AGENT_NAMES, ALL_AGENTS];
}
