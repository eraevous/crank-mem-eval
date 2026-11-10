# Proposed changes to crank-mem

Hi Chris. This is a set of changes to crank-mem, offered back to you to take, adapt or ignore.
It is based on v0.11.0 (`2d72f6c`). Each item is its own commit, with the reasons in the commit
message and black-box tests in your existing style.

Three items close safety gaps found by reading the code. Three make crank-mem easier to install
and keep healthy. The last tidies the README and extends the glossary.

Your repository has no license, so all of this stays yours to use on your terms. This
repository is public only so that you can review it; say the word and it goes private or
comes down (see `ATTRIBUTION.md`).

## Tests

With the same environment for both runs:

| | Your v0.11.0 | This branch |
|---|---|---|
| Passed | 824 | 859 |
| Failed | 29 | 29 |

- **The 29 failures are the identical set on both.** They come from the test machine, not the
  code:
  - the search model wasn't downloaded
  - running as root defeats the permission tests
- **35 new tests, all passing.** For the three safety fixes, each fix's key tests fail when
  the fix is removed.
- **Environment:** Linux, bun 1.4.4. macOS and Windows were not run.

## Safety

### 1. Indexing could follow symlinks out of the project

- **The problem:**
  - post-write checks a path only lexically, then `indexFile` reads it with `statSync` and
    `readFileSync`, which follow links.
  - The walk's `lstat` also follows a symlinked ancestor directory.
  - So a link inside the project to an outside file put that file's description, size and
    symbol names into `anatomy-index.json`.
  - The sensitive filter also judged the link's name, not the target's.
- **The fix:** one gate, `src/hooks/lib/contained.ts`, used by `indexFile` and the walk.
  - The real path must be inside the real project root.
  - The sensitive check runs on both the requested and the resolved name.
  - The file must be regular and within the size cap.
  - It is read through one descriptor opened `O_NOFOLLOW`.
- `code.ts`'s `checkedPath` already did most of this. The gate generalizes it.

### 2. A project in a monorepo subdirectory ignored the enclosing repository

- **The problem:** with no `.git` in the project root:
  - the listing fell back to a walk that skips every `.gitignore`
  - exclude mode, the default, silently wrote nothing, so `.crank/.gitignore`'s allowlist
    left `cerebrum.md`, `anatomy-index.json` and the rest committable in the parent repository
- **The fix:**
  - `git ls-files` runs from the project directory, which scopes it and applies the
    enclosing ignores.
  - Exclude mode writes the enclosing repository's `info/exclude`, and `init` warns when
    there is no repository.
- **One deliberate reversal of your design:** when git fails inside a repository, the scan now
  keeps the previous index instead of walking past `.gitignore`. Your session-start test
  expected the fallback, so this is your call. The commit and that test's new comment explain
  why.

### 3. Consolidation's file access

ADR 0011 already notes that the case-sensitive deny globs miss `.ENV`. Reading further found
more gaps:
- No hidden tree is denied, so the model can read `.git/config` (which can hold a credential
  in a remote URL), `.claude/`, `.codex/` and `.crank/`.
- Names outside the filter aren't denied either.
- Only output redaction stood behind the globs.

**The fix (ADR 0013): consolidation now runs with no tools, using the digest call's lockdown.**
- crank-mem builds the evidence itself, in `src/daemon/evidence.ts`:
  1. It takes only the files the due bullets, proposals and stale flags cite.
  2. It admits each one only if the anatomy index holds it and the gate above passes.
  3. It redacts that evidence, numbers its lines and caps it.
- A memory proposal whose cited files aren't in the evidence is rejected as `unverifiable` in
  code, whatever the model answers. Preference proposals are exempt, since code can't check a
  stated preference.
- Consolidation also gets its own switch, `crank-mem consolidate on|off`, off by default and
  kept in `config.local.json` like `digest`.
- **The trade-off:** the model can no longer explore beyond the cited files.

## Install and upkeep

### 4. `setup --core`

`--skip-dashboard` and `--skip-model` leave out one part each, and `--core` leaves out both.
The choice is kept in `~/.crank/setup.json`, so `upgrade` doesn't rebuild a dashboard nobody
asked for. Plain `setup` is unchanged.

### 5. `crank-mem doctor`, and an `init` that is safe to re-run

- **`doctor`** is read-only. It prints one line per check:
  - runtime, packages and optional parts
  - vendored hooks, plus Claude and Codex wiring
  - whether the git mode is actually in effect
  - the index and the memory switches
  - any unfinished `init`

  Each failure names the command that fixes it.
- **`init`** now:
  - writes a journal before its first change, so an interrupted run is detectable; `--resume`
    finishes it and `--rollback` undoes it, using your own `uninstall --restore` machinery
  - when re-run on a finished install, reports its health instead of refusing
  - lists every file it would change and writes nothing, with `--plan`
  - picks the wiring with `--agents claude|codex|both`

### 6. `install.sh`

One command, per user, no sudo:
- It clones a `--ref` into `~/.local/share/crank-mem/versions/<commit>/`. With `--sha`, it
  refuses any other commit.
- It runs `setup --core` there, and only then switches `current` atomically, so a failed
  setup changes nothing.
- It links `~/.local/bin/crank-mem` through `current`.
- `--rollback`, `--status`, `--prune` and `--uninstall` are built in.
- It never overwrites a `crank-mem` command it didn't make.

## Documentation

### 7. README and glossary

**The README** keeps every fact, but in shorter paragraphs and lists, in your glossary's terms.
- *What gets indexed* is corrected for change 2.
- *Upgrading*, *Requirements* and *By hand* get their own headings.
- The `.crank/` layout is a list.

**The glossary** gains four entries: Evidence, Init journal, Doctor and Setup profile.
- Evidence is kept distinct from your Excerpt, which is the cerebrum's.
- Consolidation's definition now matches change 3.

## Not done

- No live Claude Code probe of the new consolidation call. It has no tools, so there is nothing
  for deny rules to cover.
- `gateway.ts` still carries the unused `project` option from ADR 0011.
- A monorepo with two crank projects shares one exclude line, so uninstalling one removes it
  for both.

## How it was put together

The work was done with Claude, and each change's reasons were recorded as requirements,
decisions and evidence, with their limits, using **Telosmith**
([eraevous/Telosmith](https://github.com/eraevous/Telosmith)). Telosmith is a small,
standard-library Python tool that keeps the recorded reasons for code next to the code, and
flags them when the code they rest on changes. This branch neither requires nor includes it.

Two things here came straight out of writing those records:
- The consolidation trade-off is stated as an explicit decision, rather than slipping in.
- Each test-result claim carries its limits, such as Linux only and the 29 environmental
  failures, which is why they are spelled out above.

If you're curious, there is a twin branch with the records in `.aec/`. Telosmith doesn't yet
link records to TypeScript code (only Python), so for now it records the reasons but can't flag
the code changes beneath them.
