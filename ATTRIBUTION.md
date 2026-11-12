# Attribution

crank-mem is the work of **Chris Liva** ([@ChrisLiva](https://github.com/ChrisLiva)).

- Upstream: https://github.com/ChrisLiva/crank-mem
- This copy started from upstream commit `2d72f6c012cfb96926fd169251759efb3323c342` (v0.11.0,
  2026-11-10) and has since merged upstream v0.13.1 (`a6a60d9`, 2026-11-11); see "Taken from
  upstream after the base" below.
- All code, documentation, tests and design records in this repository are Chris Liva's,
  except the changes listed under "Changes in this copy" below.
- Since 2026-11-12 this is its own line: it no longer needs to stay compatible with upstream, and
  it takes from upstream's releases when that helps, crediting each one here.

## License status

**Since upstream `56192c2` (2026-11-10), upstream carries a `LICENSE` file: the Unlicense, a
public-domain dedication.** That file came in with the v0.13.1 merge and applies to the code taken
from upstream. The paragraph below describes the base commit, before that file existed, and is
kept as history.

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
  switch, off by default (ADR 0015; it was 0013 before upstream's own 0013 and 0014 arrived).

- `8940d73` — `setup --core`, `--skip-dashboard`, `--skip-model`, remembered for `upgrade`.
- `6aec30f` — `crank-mem doctor`; `init` journals itself, with `--resume`, `--rollback`, `--plan`
  and `--agents`, and reports health on a re-run instead of refusing.
- `ae95a60` — `install.sh`: one command, versioned installs, rollback, prune, uninstall.
- `8186081`, `a18ef17` — README and test-expectation follow-ups.
- `032705a` — README prose and structure tidied (facts unchanged, indexing section corrected);
  glossary entries for Evidence, Init journal, Doctor and Setup profile.

Branch `crk/integrate-v0.13.1` (handoff HO-CRK-20261112-AM3H):

- Upstream v0.13.1 merged. Conflicts resolved for this line: the containment gate and the
  no-tool consolidation stay; `setup`'s profile (`--core`, `--skip-*`) now also covers upstream's
  installed-copy mode; `upgrade --all`'s tool step respects the profile.
- `src/hooks/lib/imports.ts` (upstream's) resolves import targets, reads `go.mod` and lists Go
  package directories through the containment gate, so an import edge never follows a symlink
  out of the project. Test: `tests/imports.test.ts`, last case.
- `releaseBase()` and `scripts/install-release.sh` default to this repository's releases (none
  yet), so `self-update` never moves a user of this line onto upstream's releases.
- `install.sh` stays this line's clone installer; upstream's release installer is kept as
  `scripts/install-release.sh`, and upstream's tag-push `release.yml` workflow is left out.
- `doctor` passes the version to upstream's two-argument `dashboardCurrent`.

## Taken from upstream after the base

Chris Liva's work, merged at v0.13.1 (`a6a60d9`) under his Unlicense dedication:

- **v0.12.0:** installed release copies (`self-install`, `self-update`, `rollback`,
  `self-uninstall`, `~/.crank/versions/` and `current`), the release check and notice, and
  `upgrade --all` (ADR 0013, release-tarball distribution).
- **v0.13.0:** code-graph memory: each indexed file's imports (`src/hooks/lib/imports.ts`), one-hop
  related files (`related-files.ts`), and import-graph results fused into `search`.
- **v0.13.1:** the recall pointers and their eval (ADR 0014, `scripts/recall-eval.ts`), usage
  reach, the dashboard's Health board and activity charts, and his bug fixes in between.

Everything else in this repository is upstream's, unchanged.
