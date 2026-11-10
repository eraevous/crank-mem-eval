# 0013 — Consolidation reads an evidence bundle, not the project (design, not probe-verified)

Date: 2026-11-10. Status: accepted for the private evaluation copy (branch `proposed-changes`;
see `ATTRIBUTION.md`). It is offered to the author, not adopted upstream.
Supersedes ADR 0011's decision to give the consolidation call `Read`, `Grep` and `Glob`.
ADR 0011's findings stay valid as a record of how those tools behaved.

## Context

ADR 0011 gave the consolidation call read-only tools over the project, guarded by one
`Read(<glob>)` deny rule per `SENSITIVE_GLOBS` entry. Its own Consequences section records that
the globs are case-sensitive while the filter is not, so `.ENV` and `Secrets.json` are not
denied. A static review of the same code found four more gaps:

1. **Hidden trees.** The index never holds a dot-prefixed path, but no deny rule covers one.
   That leaves `.git/config` (which can hold a credential in a remote URL), `.claude/`, `.codex/`
   and `.crank/` readable.
2. **Names outside the filter.** A file such as `prod.env` or `terraform.tfvars` is neither
   filtered nor denied.
3. **Untested shapes.**
   - On a case-insensitive filesystem, a lowercase file may be reached by requesting another
     case.
   - A symlink inside the project may reach a target outside it.

   Whether Claude Code's matcher stops either was never probed.
4. **The backstop.** `redact()` runs on the model's output and catches token shapes and
   `key: value` pairs, not a secret restated in prose.

Each of these could be patched one glob at a time, but each patch would need a new live probe,
and the set of names would never be complete.

## Decision

- Consolidation calls `askClaude` without `project`.
  - The run has no tools, runs in `<crank home>/run`, and keeps the digest call's two-turn
    lockdown (ADR 0008), argv for argv.
  - Only the system prompt and schema differ.
- `src/daemon/evidence.ts` → `buildEvidence` gives the model what it needs instead.
  1. It takes the backticked file citations of the due bullets, the pending proposals and the
     stale flags (`citedPaths`).
  2. It resolves each citation against the anatomy index: an exact entry, or the one entry
     ending in `/<cited>`. Unindexed means refused, so every index gate applies: the
     sensitive filter in any case, hidden paths, excludes, git ignores, the size cap.
  3. It reads each resolved file only through the containment gate in
     `src/hooks/lib/contained.ts`:
     - the real path is inside the real project root
     - the sensitive check passes on both the requested and the resolved name
     - the file is regular and within size
     - the file is read and fstat'ed through one descriptor opened `O_NOFOLLOW`
  4. It redacts each admitted text on the way in.
  5. It sends excerpts of at most 400 lines a file and 60,000 characters in all. Each line is
     `<n>| <text>`, and each file has a header with a 16-hex SHA-256 prefix. Refused citations
     are listed as `=== unavailable: <path> (<reason>)`.
- A memory proposal none of whose citations was admitted is rejected with
  `UNVERIFIABLE_REASON`, and any edit carrying it is dropped, whatever the model returns.
  Preference proposals are exempt, since code cannot check a stated preference.
- Consolidation gets its own switch, `consolidate`.
  - It is off by default.
  - It is local-only, like `digest`, in `.crank/config.local.json`.
  - It is set by `crank-mem consolidate on|off`.
  - Turning digests on no longer turns consolidation on.

## Consequences

- The model can no longer explore beyond the cited files. Proposals that cite nothing
  checkable are rejected, not accepted on trust. The owner accepted this trade-off for the
  evaluation copy.
- Stale flags carry no file list in `PendingWork`, so their evidence comes only from paths
  cited in their title, narrative or reason. Using `observation_files` would be a later
  improvement.
- No probe is needed for the guard itself: no tool exists to misuse. The model still sees the
  admitted excerpts, which reach the provider under the user's own login, as the digest input
  already does.
- `gateway.ts` keeps its `project` option and ADR 0011's argv shape. Nothing calls it now.
  Removing it is a follow-up for the author.
- `tests/consolidation-evidence.test.ts` covers:
  - the gate (upper-case secrets, hidden trees, outside links, redaction, the line gutter)
  - the enforced rejection
  - the switch
  - the CLI

  `tests/consolidation.test.ts` now pins the no-tool argv and the `[EVIDENCE]` input.
