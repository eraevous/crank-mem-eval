# crank-mem — safety fixes and guided installer proposal

**Status:** private proposal for review. Not sent upstream.
**Prepared by:** ABI builder lane (Claude Opus 5.5), for Abigail and Zach, 2026-11-10.
**Subject:** `ChrisLiva/crank-mem` at `2d72f6c012cfb96926fd169251759efb3323c342` (v0.11.0).
At the time of review this is also `origin/main`.

Links below use the base
`https://github.com/ChrisLiva/crank-mem/blob/2d72f6c012cfb96926fd169251759efb3323c342/`,
abbreviated here to `@/`.

---

## 0. What this is, and what it isn't

- **Method:** static reading of the pinned source, plus my own synthetic probes of the
  filesystem and git primitives that the findings depend on.
  - crank-mem itself was **not** installed, run or tested.
  - No personal repos or transcripts were touched.
- **License:** the repo has no LICENSE file and no `license` field in `package.json`.
  - Re-checked at the pinned SHA.
  - So this proposal contains **no upstream code**. Fixes are given as implementation-ready
    specifications plus original test cases.
  - Short identifiers and line references are quoted only to locate things.
- **Labels used throughout:**
  - **[static]** read in source
  - **[ran]** my synthetic probe, run here
  - **[proposed]** not run
  - **[upstream-doc]** stated in the repo's own docs

---

## 1. Findings

### F1. The consolidation privacy gap is broader than the ADR's case note

**Priority 1. Documented upstream; widened here by static reading.**

**What happens [static]**
- After a digest, consolidation runs `claude -p` with **cwd at the project** and the tools
  `Read,Grep,Glob`, up to 40 turns.
  - `@/src/daemon/gateway.ts#L122` (`callArgs`)
  - `@/src/daemon/consolidate.ts#L26` (system prompt)
- The only file guard is `permissions.deny` holding one `Read(<glob>)` per `SENSITIVE_GLOBS`
  entry (`@/src/hooks/lib/config.ts#L189`).
- Consolidation is not separately switchable: it always follows a successful digest
  (`@/src/daemon/digest-job.ts#L114`). Digest itself is off by default.

**Gaps, most certain first**
1. **Case mismatch [upstream-doc].** `isSensitiveFile` lowercases (`#L205`), but the deny
   globs are case-sensitive. `.ENV` or `Secrets.json` is not denied.
   - Source: `@/docs/adr/0011-consolidation-read-only-tools.md` lines 89–92.
2. **Hidden trees are indexed-excluded but not read-denied [static].**
   - `isExcluded` never indexes any dot-prefixed path component.
   - The deny list has no equivalent rule, so the model can read, for example:
     - `.git/config`, which can hold a credential in a remote URL
     - `.claude/settings.local.json`
     - `.crank/` state
     - `.codex/`
     - any dot-directory a project keeps tokens in
   - ADR Finding 2 reports that one Glob listed no dotfiles. That shows nothing about
     **Read** of a known dot-path.
3. **Basename-only coverage [static].** Secret-bearing names outside the list aren't
   denied: `prod.env`, `local.settings.json`, `terraform.tfvars`, `kubeconfig`,
   `service-account.json`.
   - These are also not filtered for indexing, so they are not a new exposure, but the
     model can read them.
4. **Unverified: case-insensitive filesystems.**
   - On default macOS APFS or on Windows, a lowercase `.env` may be readable by requesting
     `src/.ENV`, if Claude Code matches deny rules against the requested string rather than
     the canonical path.
   - The ADR's probes requested exact names only. **Needs a re-probe**; not claimed.
5. **Unverified: symlinks inside the project.**
   - Whether `Read(notes.md)` on a link to `~/.ssh/id_ed25519` is denied depends on whether
     Claude Code evaluates deny rules on the link path or on the resolved target.
   - **Needs a re-probe**; not claimed.
6. **The backstop is pattern-based [static].**
   - `redact()` (`@/src/daemon/redact.ts#L37`, applied at `@/src/daemon/cerebrum-edit.ts#L70`)
     catches token formats and `key: value` or `key=value` shapes.
   - A secret paraphrased in prose ("the DB password is hunter2") passes.
   - Separately, anything the model reads has already reached the provider, under the
     user's own login.

**Proposed fix: constrained input instead of open tools.** Options, ranked:

| Option | What it does | Coverage | Cost to function | Recommendation |
|---|---|---|---|---|
| **A. Allowlisted bundle** | crank-mem builds the evidence itself and calls with `--tools ""`, as the digest call does | Closes items 1–5 by construction | The model can't explore beyond cited files. Uncited proposals become "unverifiable" (deferred, not accepted) | **Preferred** |
| B. Constrained reader | An MCP stdio tool, crank's own, as the only tool, under `--strict-mcp-config`, enforcing the same gate as A per call | Same as A, still exploratory | New tool surface; needs probing that built-in tools stay off | Fallback if A loses too much quality |
| C. Patch the globs | Case-folded globs (e.g. `**/.[eE][nN][vV]`), plus deny `**/.*/**` | Items 1–2 only, **if** Claude's matcher supports character classes (unverified) | Low | Stop-gap only; leaves 3–5 |

**Specification for Option A: `buildEvidence(root, work) → EvidenceBundle`**
1. **Candidate paths** = the union of:
   - backticked repo paths cited by RECHECK bullets
   - paths cited by pending proposals and stale flags
   - each resolved through the existing basename index
2. **Gate per path.** Reject on the first failure, recording the reason:
   - lexical: repo-relative, with no `..` and no absolute path
   - `isIndexableName` is true, which covers the sensitivity and hidden-path checks
   - **real-path containment:** `realpath(root/rel)` lies under `realpath(root)`
   - `isSensitiveFile` on **both** the requested basename and the resolved basename (the
     same rule `code.ts` already applies, `@/src/cli/code.ts#L287`)
   - `lstat` of the resolved path is a regular file, at most `max_file_size_bytes`, with no
     NUL bytes in the first sniff window
3. **Open and read**
   - Read through one handle opened on the resolved path, and re-check `fstat` on that
     handle, so a swap between check and open can't substitute a file.
   - Then apply `redact()` to the **input** text, not just the output.
4. **Shape**
   - Excerpts with line numbers, capped per file and in total (e.g. 400 lines per file,
     60 KB per bundle).
   - Each excerpt is wrapped as data, with a provenance header (`path`, `sha256`, `lines`).
5. **Call:** the ADR 0008 lockdown argv (no tools, cwd `<crank home>/run`), with the bundle
   on stdin.
   - The system prompt changes "check against the code" to "check against the evidence
     given".
   - Proposals with no admissible evidence get the verdict `rejected`, with the reason
     `unverifiable` (or a new `deferred` verdict, if the schema owner prefers).
6. **Switch:** a separate `consolidate` setting, **default off**, so turning digests on no
   longer turns consolidation on implicitly.

### F2. Indexing follows symlinks out of the project

**Static concern, plausible, not confirmed as exploitable.**

**What happens [static]**
- Post-write's `toWriteOps` validates paths **lexically** only, through `repoRelative`
  (`@/src/hooks/lib/hook-io.ts#L62`). It then calls `indexFile` (`@/src/hooks/post-write.ts#L114`).
- `indexFile` (`@/src/hooks/lib/scanner.ts#L18`) uses `statSync` and `readFileSync`, both of
  which follow symlinks. It has no `lstat` and no real-path check.
- So if `docs/notes.md` is a link to a file outside the project and an agent writes to that
  path, the outside file's derived metadata is stored in `.crank/anatomy-index.json`:
  - a description from its first lines
  - token count, size, symbol names
- The sensitivity check looks at the **link** name, not the target's.
- The full scan is mostly safe:
  - `walkTree` skips symlinks via Dirent `isFile()`.
  - `walkListing` uses `lstat` (`#L121`), which rejects a symlink as the final path
    component.
  - **But** `lstat` still follows a symlinked **parent directory**.
- The stray entry lasts until the next refresh, because a seed must appear in git's listing
  as a regular file.

**Primitive checks [ran]** (`probes/fs_probe.mjs`, Node v22.23.4; crank-mem's Bun runtime
not tested):

| Check | Result |
|---|---|
| lexical relative path for a final-component link | `docs/notes.md` (accepted) |
| lexical relative path through a symlinked parent dir | `linked/notes.md` (accepted) |
| `statSync` on the link | follows; reports a regular file |
| `readFileSync` on the link | reads the **outside** file's first line |
| `lstat` on the final link | `isFile() = false` (rejected) |
| `lstat` through a symlinked parent dir | `isFile() = true` (**accepted**) |
| Dirent for a symlinked dir | `isFile() = false`, `isDirectory() = false` (skipped) |
| real-path containment test | rejects the outside target |

**Proposed fix**
- One shared gate, `admitPath(root, rel) → realAbs | Reject`, with the same steps as
  Option A's step 2.
- Used by `indexFile`, the walk filters and every reader that should stay inside the
  project.
- `code.ts`'s `checkedPath` already does most of this and can be the model for it.

### F3. Monorepo subdirectory installs, and git failure, widen what is indexed and committable

**Partly static, partly confirmed with synthetic git.**

1. **Ignored files get indexed [static + ran].**
   - `gitListing` uses git only if `<root>/.git` exists (`@/src/hooks/lib/activity.ts#L42`).
   - Otherwise, and on **any** git error, `walkTree` is used (`scanner.ts#L167`), and
     `walkTree` doesn't consult `.gitignore` at all.
   - In a monorepo subdirectory, files ignored by the parent repo (local data, notes,
     generated output) become index candidates. The default excludes are only
     `node_modules`, `dist`, `build`, `coverage`, `__pycache__`, `target` and minified
     assets.
   - **[ran]** From a subdirectory, `git ls-files -co --exclude-standard` works and honours
     the parent's `.gitignore`. The ignored `local-data.csv` was correctly left out.
     So the fix is cheap.
2. **Exclude mode silently does nothing [static + ran].**
   - `init` takes `process.cwd()` as the root (`@/src/cli/init.ts#L36`) and defaults to
     `git: exclude` (`#L67`).
   - `modeIgnoreFile` returns nothing when `<root>/.git` is missing
     (`@/src/cli/install-support.ts#L47`), and no warning is printed.
   - The only remaining rule is `.crank/.gitignore`'s allowlist
     (`@/src/cli/settings.ts#L311`). That allowlist **re-admits**:
     - `cerebrum.md` and `cerebrum-archive.md`
     - `journal.md`
     - `anatomy.md` and `anatomy-index.json`
     - `config.json`
     - `hooks/`
   - **[ran]** In a synthetic monorepo, every re-admitted file appeared as untracked, so
     `git add -A` would commit it. A user who chose "exclude" expected none of `.crank/` in
     git.
   - `memory.db` is not re-admitted, so it stays ignored.
3. **Proposed fix**
   - Find the repo with `git rev-parse --show-toplevel` from the root. Run
     `ls-files -co --exclude-standard` scoped to the root.
   - Write exclude-mode rules to `<toplevel>/.git/info/exclude`, with a path scoped to the
     subdirectory. If `.git` is a file (a worktree or submodule), use
     `git rev-parse --git-path info/exclude`.
   - **Fail closed:** if an enclosing repo exists but git fails, keep the previous index and
     report it, rather than walking unfiltered. Use `walkTree` only when no enclosing repo
     exists.
   - `init` and `doctor` warn whenever the chosen git mode can't take effect.

---

## 2. Guided one-command installer, doctor and rollback (Priority 2)

**Current state [static]**
- Install is three manual steps: clone, symlink into `~/.local/bin`, then `crank-mem setup`.
  After that, `init` runs per project.
- `setup` **always** does all of the following (`@/src/cli/setup.ts#L56`):
  - installs the core packages
  - installs **and builds the dashboard**
  - downloads the search model `Xenova/all-MiniLM-L6-v2` (`@/src/daemon/embedder.ts#L8`)
- Good existing choices, to keep:
  - `bun install --frozen-lockfile`
  - an npm fallback with `--ignore-scripts --no-package-lock`
  - per-writer backups and `uninstall --restore`
  - guarded hook commands
  - Codex trust defaulting to review
- Gaps for a one-command experience:
  - `init` refuses to re-run once `.crank/config.json` exists.
  - A partial `init` prints a restore hint instead of rolling back
    (`@/src/cli/init.ts#L118`).
  - Claude wiring is always applied. There is no "Codex only" option.
  - There is no plan or preview of config changes, and no read-only doctor.

### 2.1 User experience (target)

```
curl -fsSLO https://<release>/install-crank-mem.sh      # download, inspect, then run
sh install-crank-mem.sh                                 # or: sh install-crank-mem.sh --yes --agents claude
```

1. **Preflight (read-only):**
   - OS
   - runtime (bun, or node ≥ 23.6)
   - git
   - `~/.local/bin` on PATH
   - any existing install and its version
   - free disk
2. **Choose:**
   - agents: `claude` / `codex` / `both` (default: those detected)
   - profile: **core** (default) or `+dashboard` / `+search-model`
3. **Fetch** a pinned release into `~/.local/share/crank-mem/<version>/`.
   - Verify a published SHA-256, or a signed tag when available.
   - Install packages from the lockfile, with scripts disabled.
4. **Activate:** atomically point `~/.local/share/crank-mem/current` and the
   `~/.local/bin/crank-mem` symlink at the new version.
5. **Optional, per project:** `crank-mem init --plan` prints every file it will create or
   change as a **unified diff**. Then `crank-mem init --apply` applies that plan.

**Fixed defaults:**
- consolidation **off**, with digest also off unless chosen
- Codex hook trust **review**, never auto-write
- dashboard and model **not** installed
- no `sudo`; everything per-user

### 2.2 Transactional init (the core change)

- **Plan object**
  - One entry per install item: `{item, path, before_sha256|absent, after_content|delete}`.
  - The plan is computed entirely before anything is written.
  - The `--plan` output is that list rendered as diffs.
- **Journal**
  - Before the first write, save `.crank/install-journal.json` holding the plan, its id, a
    timestamp and the backup dir, with each entry marked `pending`.
  - After each successful write, the entry becomes `applied`.
- **Interrupted run.** The next `init` or `doctor` finds the journal and offers:
  - **resume:** re-check each `pending` entry's `before_sha256`, then apply; or
  - **roll back:** restore each `applied` entry from backup.

  Both refuse to proceed if a file changed after the plan was made, and show the diff.
- **Idempotency**
  - Re-running `init` with an existing config computes a plan. An empty plan exits 0 with
    "already up to date".
  - A non-empty plan is shown, and nothing changes without confirmation. This replaces the
    hard refusal.
- **Hook preservation**
  - Each merge into `.claude/settings*.json`, `.codex/hooks.json` or `config.toml` touches
    only crank-owned entries.
  - Foreign hooks and edited crank commands are kept byte for byte, which matches the
    current `upgrade` behaviour.
- **Upgrade** = install the new version side by side, run `doctor`, then plan, apply and
  switch `current`.
  - **Rollback** = repoint `current` to the previous version, plus `uninstall --restore`
    semantics for project files.
- **Uninstall** stays as it is, plus:
  - the version directories are removed (or the last two kept)
  - the PATH symlink is removed only if it points into the managed directory

### 2.3 `crank-mem doctor` (read-only)

Runs every install item's check without writing anything, and returns exit 0, or 1 with
one line per problem plus a suggested command.

| Check | Example output |
|---|---|
| runtime and version | `bun 1.4.4 ok` |
| install health | the active version symlink is valid, the lockfile is intact |
| per-project wiring | hooks present, guarded, and not duplicated across shared and local settings |
| git mode effective | **warns on F3's case:** `exclude mode has no effect: no .git at project root` |
| consolidation | off / on; on → warns if F1 isn't fixed in this version |
| Codex trust | review pending / current / stale hash |
| leftover journal | `interrupted init from <time>: run init to resume or roll back` |
| optional parts | dashboard built for this version? model present? |

---

## 3. Original test specification (all [proposed]; none run against crank-mem)

| # | Area | Synthetic fixture | Action | Expected |
|---|---|---|---|---|
| T1 | F1 | project with `.ENV`, `Secrets.json`, `.git/config` holding `https://u:SYNTH@host`, `prod.env`, link `notes.md → ../outside/id_ed25519` | build the evidence bundle for proposals citing each | none admitted; each rejection reason recorded |
| T2 | F1 | `src/lock.ts` cited by a RECHECK bullet | build bundle | admitted, with sha256, line numbers and the data wrapper |
| T3 | F1 | consolidation run under Option A (spawn stubbed) | inspect argv | `--tools ""`, cwd under crank home, no project cwd |
| T4 | F1 | proposal with no admissible citation | run with a stubbed model | verdict `rejected` / `unverifiable`; cerebrum unchanged |
| T5 | F1 | swap a file between the gate check and the open | read | the swapped content is not returned |
| T6 | F1 | digest on, consolidate unset | run the digest job (stubbed) | consolidation not invoked |
| R1 | F1 re-probe | case-insensitive FS, lowercase `.env`; request `.ENV` (live Claude Code, sentinel content) | current deny-rule setup | records whether it was denied (decides the urgency of F1 item 4) |
| R2 | F1 re-probe | symlink to a sentinel file outside the project | Read via the link | records whether it was denied (F1 item 5) |
| T7 | F2 | final-component link to an outside file | post-write `indexFile` | null; no entry written |
| T8 | F2 | a file reached through a symlinked parent directory | walk + `indexFile` | rejected |
| T9 | F2 | link named `readme.md` → `id_rsa` inside the project | `indexFile` | rejected by the target-name sensitivity check |
| T10 | F3 | monorepo, root = `packages/app`, parent ignores `local-data.csv` | full scan | ignored file absent from the index |
| T11 | F3 | same, `git: exclude` | init | the rule is written to the toplevel's `info/exclude`, scoped to the subdir; `git status` shows no `.crank` file |
| T12 | F3 | enclosing repo, git forced to fail | refresh | previous index kept; event logged; no unfiltered walk |
| T13 | install | kill `init --apply` after entry 2 of 5 | rerun `init` | resume and roll back both offered; each yields a consistent state |
| T14 | install | `init` twice | second run | empty plan, exit 0, no backup written |
| T15 | install | foreign Claude hook plus a user-edited crank command | init / upgrade / uninstall | both kept byte for byte |
| T16 | install | `--agents codex` | init | no `.claude/` writes |
| T17 | install | default profile | setup | no dashboard build, no model download, no network beyond packages |
| T18 | install | upgrade, then rollback | switch `current` | previous version runs; project files restored |
| T19 | doctor | each broken state from T11–T13 | doctor | exit 1, one specific line each, no writes (verified by tree hash) |

---

## 4. Verification actually performed

- **[ran]** `probes/fs_probe.mjs` (original): the 8 primitive results in the F2 table, on
  Node v22.23.4, Linux.
- **[ran]** `probes/git_monorepo_probe.sh` (original): F3 items 1 and 2.
  - The subdirectory `ls-files` honoured the parent ignore.
  - There was no `.git` at the subdir root and no `info/exclude` target.
  - 5 allowlisted state files showed as untracked in the parent.
  - `rev-parse --show-toplevel` found the parent.
  - A git failure exits 128.
  - The allowlist used there has the same shape as upstream's but is my own synthetic text.
- **[static]** Every other claim was read at the pinned SHA, with locations linked above.
- **Not done:**
  - running crank-mem or its test suite
  - any live Claude Code probe (R1 and R2 are specified, not run)
  - Bun-specific behaviour
  - macOS or Windows filesystems

---

## 5. Blockers and decisions

1. **No license.** Upstream contributions are blocked until the maintainer adds one, or
   grants permission. Until then:
   - Deliverables stay as specification plus original tests.
   - No fork or repackaging into Kairos.
   - Contacting the maintainer is Zach's call; not done.
2. **Write access.** Pull only, with no push. Matches the assignment, which is review only.
3. **Live re-probes R1 and R2** need a Claude Code session against a synthetic sentinel
   project. That costs a few cents of model usage on the user's login.
   - Not run, because it would mean running Claude tooling against files with a security
     purpose. That needs explicit go-ahead.
4. **Option A versus B for consolidation quality** is a product decision for the
   maintainer. A loses exploratory verification.
5. **Signed Mac one-click package:** out of scope, as stated.
6. **Later integration**, not adopted: a versioned, read-only search/export adapter on one
   non-sensitive repo, with Anamnesis keeping cross-project authority. It depends on F2's
   `admitPath` gate and F3's fix, so that the exported index can't carry out-of-tree or
   git-ignored content.
