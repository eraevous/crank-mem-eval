# 0016 — One adapter per agent (design, not probe-verified)

Date: 2026-11-16. Status: proposed (issue #1, A1; handoff HO-CRK-20261116-65M7). It adds no probe
and changes no probed behavior: every agent fact it relies on is already recorded in ADRs
0001–0012, and the move is a refactor that the full suite must pass unchanged.

## Context

Claude Code and Codex are named directly in at least six places:

| Concern | Where it lives now |
|---|---|
| Hook map per agent (events, matchers, `$CLAUDE_PROJECT_DIR` vs cwd paths) | `src/cli/settings.ts` → `crankHooks`, `commandParts` |
| Settings files: wire, repair, remove | `src/cli/install-agents.ts` → `claudeWiring`, `codexWiring` |
| Trust step (Codex `trusted_hash`, ADR 0002) | `src/cli/codex-trust.ts`, called from `codexWiring` |
| Which agent sent a payload | `src/hooks/lib/hook-io.ts` → `isCodexPayload` (ADRs 0006, 0007) |
| Written and read paths in a payload | `src/hooks/post-write.ts` → `toWriteOps` (Write/Edit/MultiEdit vs `apply_patch`, ADR 0003), `src/hooks/post-read.ts` (Read, Bash) |
| Transcript to distill | `src/daemon/transcript.ts` (Claude JSONL only; Codex sessions are not digested) |
| `--agents` names | `src/cli/init.ts` (a literal `claude \| codex \| both` list) |

A third agent would have to touch every row. The table is also the only place the split is
written down.

## Decision

Each agent is one **adapter**, and one **registry** lists the adapters in a fixed order. The
adapter has two halves, because hooks are vendored into each project and may import only `node:`
modules and files under `src/hooks/` (CLAUDE.md), while wiring and trust stay CLI-side.

### Hook half: `src/hooks/lib/agents.ts` (vendored, `node:` imports only)

```ts
export type AgentName = "claude" | "codex";

/** What a hook needs from one payload, whichever agent sent it. */
export interface HookEvent {
  agent: AgentName;
  event: string | null;          // hook_event_name as sent
  cwd: string | null;
  tool: string | null;           // tool_name as sent, for usage lines
  writes: { path: string; deleted: boolean }[]; // raw paths; post-write still resolves and gates them
  reads: string[];               // raw paths; post-read still resolves and gates them
}

export interface PayloadAdapter {
  name: AgentName;
  /** True when this agent sent the payload. Checked in registry order; the last adapter is the fallback. */
  owns(payload: HookPayload): boolean;
  parsePayload(payload: HookPayload): HookEvent;
}

export const PAYLOAD_ADAPTERS: readonly PayloadAdapter[]; // [codex, claude]: Claude is the fallback, as today
export function agentFor(payload: HookPayload): PayloadAdapter;
```

`isCodexPayload` becomes `agentFor(p).name === "codex"`, with the same tests (ADR 0006 rollout
name, ADR 0007 `turn_id`). `parseApplyPatch` and `shell-reads.ts` stay where they are; the Codex
and Claude adapters call them. Path resolution, the containment gate and the `.crank/` skip stay
in the hooks, so the security-relevant code does not move.

### CLI half: `src/cli/agents.ts`

```ts
export interface AgentAdapter {
  name: AgentName;
  label: string;                                   // "Claude Code", "Codex", for report lines
  hooks(runtime: CrankConfig["runtime"]): HooksMap; // today's crankHooks(runtime, name)
  commandPath(script: string): string;             // today's commandParts path rule
  enabled(config: CrankConfig): boolean;           // reads today's config keys: claude !== "skip", codex !== "skip"
  wiring: InstallItem;                             // wire = apply, repair, remove (today's claudeWiring / codexWiring)
  trust?: {                                        // optional review or trust step; Codex only
    status(root: string): TrustStatus;
    write(root: string, backup: (f: string) => void): string[];
    remove(root: string): string[];
  };
  readTranscript?(file: string, after: Position | null, maxChars: number): Distilled; // Claude only
}

export const AGENTS: readonly AgentAdapter[];      // [claude, codex]: install order as today
export function agentNames(): string[];            // what --agents accepts, plus "both" as an alias for all
```

- `install.ts` keeps its ordered item list but takes the wiring items from `AGENTS` in order, so
  install, repair and remove output keeps today's order line for line.
- `settings.ts` → `commandForms` iterates `AGENTS` instead of the literal pair, so every command
  form either agent has emitted is still recognised.
- `init`'s `--agents` validates against `agentNames()`; the usage string in `commands.ts` is built
  from it. `both` stays accepted.
- **Config shape does not change.** `claude: "skip"` and `codex: merge|skip|trust|review` keep their
  meanings; each adapter reads its own key. A per-agent `agents` block is a later question, not this
  one, because changing it means a migration for every registered project.
- `codex-sessions.ts` (does the injection reach Codex threads, ADR 0006) stays a Codex-only check
  that `stats` calls; it is not part of the interface yet. One agent having it is not a pattern.

### Order of work (one PR, each step leaves the suite green)

1. Registry and `--agents` from it (no behavior change visible).
2. CLI half: `hooks`, `commandPath`, `wiring`, `trust` move behind the adapters; `install-agents.ts`
   becomes the two adapter files.
3. Hook half: `agentFor` and `parsePayload`; `post-write`, `post-read`, `session-start` and
   `usage.ts` read `HookEvent` instead of `tool_name` and `isCodexPayload`.
4. `readTranscript` on the Claude adapter; the daemon reaches `distill` through it.

New tests (black-box where the behavior is reachable, per CLAUDE.md): `--agents` rejects a name
not in the registry; `crankHooks` output for each adapter is byte-identical to today's, pinned by a
golden; a payload owned by neither specific rule falls back to Claude.

## Consequences

- A new agent is two files and one registry line, plus whatever probes its ADR needs. The table
  above shrinks to "see `src/cli/agents.ts`".
- `HookEvent` is one more shape crossing the vendored boundary. `drift.ts` already warns when the
  vendored hooks lag the CLI, so an old vendored copy is caught the same way as today.
- The refactor touches hook files; Lydian's hook-guard needs their new fingerprints before the PR
  can go green (lane prompt §4).

## Dissent review (AGENTS rule for a change of module responsibility)

1. **What it might violate:** "hooks import nothing outside `src/hooks/`" and "don't change
   ADR-covered behavior without re-probing".
2. **Evidence for the concern:** the hook half moves payload knowledge that ADRs 0003, 0006 and
   0007 cover into a new file.
3. **Counter-evidence:** the rules move as code, not as new behavior; the existing payload fixtures
   (`tests/fixtures/payloads.ts`) and `tests/hooks-imports.test.ts` run unchanged against it.
4. **If the concern is right:** a Codex payload is misread as Claude and its writes are not
   indexed; hooks still exit 0, so the failure is silent staleness, not a broken session.
5. **What to test:** the full suite unchanged, plus the fallback-order test above. Escalate if any
   existing payload test needs editing to pass.

## Open questions

- Should `trust` be a separate optional part, or simply part of the Codex adapter's `wiring`?
  Keeping it separate lets `doctor` report trust for any agent that has it; folding it in is less
  surface. This ADR keeps it separate.
- Should the hook half key on `hook_event_name` per agent (a mapping table), or keep today's
  per-script hooks? Today's scripts already match one event each, so this ADR keeps them.
