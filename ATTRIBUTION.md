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
- Any change here is intended to be offered to the author for upstream inclusion, on his terms.

## Changes in this copy

Branch `aegis/safety-fixes`, prepared for Zach Rhodes with Claude (Anthropic).
Each change is listed with its commit; see `git log 2d72f6c..` for the full history.

- `a48249f` — this file, and Telosmith records in `.aec/` (purpose, requirements, decisions).
- `3aeb6e0` — confine indexing to the project by real path (`src/hooks/lib/contained.ts`).
- `3b776c0` — honour the enclosing repository for monorepo subdirectory projects; a git failure
  inside a repository now keeps the previous index (reverses an upstream fallback, see the
  commit message).
- `8b537c1` — consolidation reads a gated evidence bundle with no tools, behind its own
  switch, off by default (ADR 0013).

Everything else in this repository is upstream's, unchanged.
