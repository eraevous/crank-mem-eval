# Draft tickets: more agents, more operating systems

**Status:** filed as issues #1–#6 on `eraevous/crank-mem-eval` (labels `agents` and `platform`).
**Builds on:** this branch, `aegis/safety-fixes`, the working branch from here on.

| Ticket | Issue |
|---|---|
| A1 | https://github.com/eraevous/crank-mem-eval/issues/1 |
| A2 | https://github.com/eraevous/crank-mem-eval/issues/2 |
| A3 | https://github.com/eraevous/crank-mem-eval/issues/3 |
| B1 | https://github.com/eraevous/crank-mem-eval/issues/4 |
| B2 | https://github.com/eraevous/crank-mem-eval/issues/5 |
| B3 | https://github.com/eraevous/crank-mem-eval/issues/6 |

crank-mem's own rule applies throughout: agent behaviour is **probed live and recorded as an
ADR before code depends on it**, as ADRs 0001–0012 do. No ticket below assumes how a tool
behaves.

---

## Track A: other LLM agents

### A1. Agent adapter interface (do first)

- **Why:** Claude Code and Codex are hard-wired in several places:
  - `install-agents.ts`: settings wiring
  - `hook-io.ts` and `isCodexPayload`: payload shapes
  - `apply-patch.ts`: Codex write events
  - `transcript.ts` and `codex-sessions.ts`: transcript formats
  - `settings.ts` → `crankHooks`: hook maps

  Every new agent would otherwise touch all of them.
- **Do:** define one `AgentAdapter` with these parts:
  - `wire`, `repair` and `remove` (settings file paths and hook map)
  - `parsePayload` (event name, cwd, written and read paths)
  - `readTranscript` (records to distill)
  - `trust` (an optional review or trust step, as Codex has)

  Then move Claude Code and Codex onto it, with no behaviour change.
- **Done when:** the full suite passes unchanged, and `--agents` takes adapter names from one
  registry.

### A2. Probe and add more coding agents, one ADR each

- **Candidates to probe:** Gemini CLI, Cursor (agent/CLI), Aider, OpenCode, Cline.
- **For each, record in an ADR:**
  - whether it has lifecycle hooks (session start, after write, after read, stop)
  - where its config lives
  - what its payloads look like
  - where transcripts are kept, and in what format
  - whether text injected at session start reaches the model
- **Then:** add an adapter for each agent that has enough hooks. For one without hooks, decide
  whether a file-watcher or wrapper mode is worth it. That's a design decision, not an
  assumption.
- **Done when:** each adapter added has black-box tests with a fake binary for that agent,
  like `fakeClaude`, and `doctor` checks its wiring.

### A3. A provider abstraction for digests and consolidation

- **Why:** `gateway.ts` → `askClaude` is the only model call, and it is tied to `claude -p` on
  a claude.ai login (ADR 0008).
- **Do:** a `ModelProvider` interface. Each provider must keep the lockdown properties:
  - no tools
  - a minimal environment
  - structured output
  - a timeout
  - classified failures
- **Candidates:**
  - `codex exec`
  - an OpenAI-compatible API (with a key from the environment, never committed)
  - a local model (Ollama or llama.cpp server) for no-egress setups
- **Selection:** in `config.local.json`, like `digest`, so a committed config can't redirect
  data to another provider.
- **Done when:** each provider has a fake-server test, and `doctor` shows the provider and
  where data goes.

---

## Track B: other operating systems

### B1. macOS validation

- **To check:**
  - `install.sh` on BSD userland: `mv -h` for the atomic switch, plus `readlink` and `sed`
    differences
  - the launcher's `readlink -f`, which needs macOS 12.3 or later
- **Re-probes from the review:**
  - **R1:** on a case-insensitive filesystem (APFS), does any remaining path match the wrong
    case?
  - **R2:** symlink handling under the containment gate.
- **Done when:** the suite passes on a macOS runner, plus a recorded run of `install.sh` on a
  clean user account.

### B2. Windows support

- **Why it fails today:**
  - `bin/crank-mem` and `install.sh` are POSIX shell.
  - Hook commands are written as `[ ! -f <script> ] || bun <script>`, which is shell syntax.
    How Claude Code and Codex run hooks on Windows needs probing.
  - `contained.ts` uses `O_NOFOLLOW`, which Windows lacks, and symlinks and junctions behave
    differently there.
- **Do:**
  - `install.ps1` and a `crank-mem.cmd` launcher, per user, with no admin rights
  - hook commands that run in whatever shell each agent uses on Windows (probe first)
  - a Windows path through the containment gate (real-path check, reparse-point refusal)
  - path-separator review across `repoRelative`, `toPosix` and the backup manifest
- **Done when:** the suite passes on a Windows runner, and install, `init` and `doctor` work
  for a non-admin user.

### B3. Test on all three operating systems in CI

- **Do:** a GitHub Actions matrix (Linux, macOS, Windows) running:
  - `bun test` (search-model tests skipped where the model isn't cached)
  - `bun run typecheck`
  - `oxfmt --check`
  - `install.sh` or `install.ps1` against the checked-out commit
- **Done when:** a failure on any platform blocks a merge, and the load-sensitive tests from
  CLAUDE.md are marked or retried, not silently ignored.

---

## Suggested order

1. **A1**, the refactor everything else needs.
2. **B3**, the CI matrix, so every later change is seen on every OS.
3. **B1**, macOS: the cheapest OS.
4. **A2**, starting with the agent Zach uses most after Claude Code and Codex.
5. **B2**, Windows: the largest.
6. **A3**, providers. It's independent of A2 and can run in parallel. The local-model provider
   also serves the no-egress goal.
