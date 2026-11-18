# Attribution

crank-mem is the work of **Chris Liva** ([@ChrisLiva](https://github.com/ChrisLiva)).

- Upstream: https://github.com/ChrisLiva/crank-mem
- This line restarts from upstream **v0.16.0** (`e495c64`, 2026-11-16). An earlier line of this
  copy started from v0.11.0 (`2d72f6c`) and merged v0.13.1 (`a6a60d9`); its history stays on
  `main` and its attribution file is in `git show 54ebb91:ATTRIBUTION.md`.
- All code, documentation, tests and design records in this repository are Chris Liva's, except
  the changes listed under "Changes in this copy" below.
- Since 2026-11-12 this is its own line: it no longer needs to stay compatible with upstream, and
  it takes from upstream's releases when that helps, crediting each one here.

## License

Upstream carries a `LICENSE` file since `56192c2` (2026-11-10): the Unlicense, a public-domain
dedication. It applies to everything taken from upstream, which in this line is the whole v0.16.0
base. Changes made in this copy are offered under the same terms.

## Changes in this copy

Prepared for Zach Rhodes with Claude (Anthropic), on branch `crk/rebase-v0.16`. Each change below
was re-applied onto v0.16.0 from the earlier line, with its own test. See `git log e495c64..` for
the full history.

- `64d0f6e`: Codex `trusted_hash` entries are written only for crank-mem's own generated hook
  commands.
- `e7bd4fc`, `935ca02`, `df11a3f`: hooks and the launcher run bun with `--env-file=/dev/null`, so
  a project's `.env` files can't set the hook's or the daemon's environment.
- `312d222`, `1e3cbfc`, `1705269`: a project in a repository subdirectory honours the enclosing
  repository; uninstall keeps a shared exclude block while another project still uses it.
- `a7610c8`, `e41e889`: secret redaction of keyed values and URL credentials runs in linear time
  on long hyphenated runs, and masks every case v0.16 masked.
- `d120545`, `4ea27b8`: post-read ends `<<-` heredoc bodies at a tab-indented terminator and
  treats `<<<` as a here-string.
- `b1ea34f`, `5caac23`: the PATH line `self-install` writes quotes the bin dir as one literal.
- `6ab0bbb`: `upgrade --all` reports a project whose repair throws and goes on with the rest.
- `25f51de`, `404bba5`: a bun test workflow on pull requests, `main` and `crk/**` branches.
- `31673a8`: a race fix in this copy's own signals test.
- `docs/requirements/`: requirement records written by a reviewer (API Kate, OpenAI) under the
  Braided pilot, committed verbatim; each file names its source.
- This file.
