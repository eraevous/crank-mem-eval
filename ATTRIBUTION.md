# Attribution

crank-mem is the work of **Chris Liva** ([@ChrisLiva](https://github.com/ChrisLiva)).

- Upstream: https://github.com/ChrisLiva/crank-mem
- This copy is based on upstream commit `2d72f6c012cfb96926fd169251759efb3323c342` (v0.11.0, 2026-11-10).
- All code, documentation, tests and design records in this repository are Chris Liva's,
  except the changes listed under "Changes in this copy" below.

## License status

At the base commit, upstream has no LICENSE file and declares no license, so all rights stay with
the author. This repository is public so that the author can review the proposed safety and
installer changes in it:

- It is not a release, a fork to depend on, or a replacement for upstream: install crank-mem
  from upstream.
- Any change here is offered to the author for upstream inclusion, on his terms.
- If the author asks, this repository will be made private or taken down.

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

- `8940d73` — `setup --core`, `--skip-dashboard`, `--skip-model`, remembered for `upgrade`.
- `6aec30f` — `crank-mem doctor`; `init` journals itself, with `--resume`, `--rollback`, `--plan`
  and `--agents`, and reports health on a re-run instead of refusing.
- `ae95a60` — `install.sh`: one command, versioned installs, rollback, prune, uninstall.
- `8186081`, `a18ef17` — README and test-expectation follow-ups.
- `032705a` — README prose and structure tidied (facts unchanged, indexing section corrected);
  glossary entries for Evidence, Init journal, Doctor and Setup profile.

Everything else in this repository is upstream's, unchanged.
