# Attribution

crank-mem is the work of **Chris Liva** ([@ChrisLiva](https://github.com/ChrisLiva)).

- Upstream: https://github.com/ChrisLiva/crank-mem
- This copy is based on upstream commit `2d72f6c012cfb96926fd169251759efb3323c342` (v0.11.0, 2026-11-10).
- All code, documentation, tests and design records in this repository are Chris Liva's,
  except the changes listed under "Changes in this copy" below.

## License status

At the base commit, upstream has no LICENSE file and declares no license, so all rights stay with
the author. This copy is a **private evaluation copy** of proposed safety and installer changes:

- It is not redistributed, published or offered as a replacement for upstream.
- Every change here is offered to the author for upstream inclusion, on his terms.

## Changes in this copy

Branch `proposed-changes`, prepared by Zach Rhodes with Claude (Anthropic). `git log 2d72f6c..`
lists one commit per change, each with its reasons and tests; `PROPOSED-CHANGES.md` is the
overview.

1. Indexing stays inside the project by real path (`src/hooks/lib/contained.ts`).
2. A project in a monorepo subdirectory honours the enclosing repository's ignores, and exclude
   mode works there; a git failure inside a repository keeps the previous index.
3. Consolidation reads a gated evidence bundle with no tools, behind its own switch, off by
   default (ADR 0013).
4. `setup --core`, `--skip-dashboard` and `--skip-model`, remembered by `upgrade`.
5. `crank-mem doctor`; `init` journals itself (`--resume`, `--rollback`), previews (`--plan`),
   picks agents (`--agents`), and reports health on a re-run instead of refusing.
6. `install.sh`: one command, versioned installs, rollback, prune, uninstall.

Everything else in this repository is upstream's, unchanged.
