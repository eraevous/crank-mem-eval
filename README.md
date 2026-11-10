# crank-mem

Project memory for coding agents (Claude Code and Codex).

crank-mem keeps two things for each project and hands them to every new session:

- an **anatomy**: a token-annotated index of the project's files, refreshed whenever an agent
  writes one;
- a **cerebrum**, `.crank/cerebrum.md`: short memory bullets, injected at session start. Claude
  Code subagents get a 2 KB excerpt of it.

With digests on, Claude Code sessions are also digested automatically into a per-project store,
`.crank/memory.db`. Agents search it with `crank-mem search`, `timeline` and `get`, and it shows up
at session start and when an agent reads a file it covers. Consolidation, which is off until
`crank-mem consolidate on`, then checks what sessions proposed against evidence from the files they
cite, and keeps `cerebrum.md`.

No hook asks the agent to keep memory. Hooks are advisory-only: they always exit 0.

## Install

One command, per user, no sudo. Read the script first: it is short, and it says what it touches.

```sh
curl -fsSLO https://raw.githubusercontent.com/ChrisLiva/crank-mem/main/install.sh
sh install.sh                      # core: packages only; add --with-dashboard and/or --with-model
cd <your project>
crank-mem init --plan              # what init would change, writing nothing
crank-mem init                     # then check any time with: crank-mem doctor
```

`install.sh` works in four steps, and a failure at any step leaves the version you had in place:

1. It clones the chosen `--ref` (default `main`) into
   `~/.local/share/crank-mem/versions/<commit>/`. With `--sha <commit>`, it refuses any other
   commit.
2. It runs `crank-mem setup --core` in that clone.
3. Only then does it switch `~/.local/share/crank-mem/current` to the new clone.
4. It links `~/.local/bin/crank-mem` through `current`, once. It never replaces a `crank-mem`
   command it did not make.

Running it again is safe. Its other modes:

- **Upgrade:** run it again with a newer `--ref`, then `crank-mem upgrade` in each project.
- `--rollback` switches back to the previous clone.
- `--status` lists the clones.
- `--prune` deletes all but the current and previous clones. Projects point at the clone they
  were set up from, so older clones are kept until you prune.
- `--uninstall` removes the clones and the command. Run `crank-mem uninstall` in each project
  first; `~/.crank` stays.

### By hand

```sh
git clone <this repo> ~/GitHub/crank-mem
ln -s ~/GitHub/crank-mem/bin/crank-mem ~/.local/bin/crank-mem
crank-mem setup          # once per machine: packages, the dashboard build and the local search model
cd <your project> && crank-mem init
```

`setup` installs the clone's packages, then the `dashboard/` packages. It builds the dashboard
into `dashboard/dist/`, stamps the build with the clone's version, and downloads the search model.

`setup --core` installs the packages only. `--skip-dashboard` and `--skip-model` each leave out
one part. The choice is kept in `~/.crank/setup.json`, and `upgrade` respects it.

### Requirements

crank-mem needs bun, or node >= 23.6; either runs TypeScript directly. The dashboard is the one
built part, and `crank-mem setup` builds it.

Hooks import only `node:` modules. Three packages load only when a command needs them:

- `@huggingface/transformers`, for search by meaning;
- `web-tree-sitter` with `@vscode/tree-sitter-wasm`, for `outline` and `unfold`.

### Upgrading

With a by-hand clone, upgrading is `git pull` in the clone, then `crank-mem upgrade` in each
project. Upgrade brings every item back to the choices init recorded in `.crank/config.json`:

- **Hooks:**
  - It re-vendors the hooks copied into `.crank/hooks/` whenever they differ from the clone.
  - It adds hook wiring the install lacks, such as `SubagentStart`.
  - It rewrites hook commands crank-mem wrote into their current form. A hook command you
    edited stays as written.
- **Claude Code settings:**
  - It adds the `Bash(crank-mem search *)`, `Bash(crank-mem timeline *)`,
    `Bash(crank-mem get *)`, `Bash(crank-mem outline *)` and `Bash(crank-mem unfold *)` allow
    rules to the wired settings file.
  - It removes crank hooks from the Claude settings file the git mode does not use, since wiring
    in both runs every hook twice.
- **Codex:**
  - When init wired Codex, it re-wires `.codex/hooks.json` and the `[features]` snippet in
    `.codex/config.toml`.
  - With `--codex-trust write`, it recomputes the trusted hashes only when one is missing or
    stale.
- **Packages and dashboard:**
  - It installs the clone's packages.
  - It rebuilds the dashboard when its build stamp is not the clone's version, unless `setup`
    left the dashboard out. A failed build prints a warning, and the upgrade goes on.
- **Memory files:** it re-seeds a missing `cerebrum.md`.
- **Git:**
  - It replaces a `.crank/.gitignore` that is not the current allowlist.
  - In commit mode, it removes crank-mem's own `.crank/` ignore block, left by an earlier ignore
    or exclude mode init, so `cerebrum.md` can be tracked.
  - In ignore or exclude mode, it adds the `.crank/` ignore block back to `.gitignore` or to
    the repository's `info/exclude` when the block is missing.

A failed repair prints a warning, every other repair still runs, and the upgrade exits 1. An
upgrade that changes nothing writes no backup.

Hook commands are guarded, `[ ! -f <script> ] || bun <script>`, so a checkout that has the
committed settings file but no `.crank/hooks/` exits 0 instead of reporting a hook error.

Codex hashes each hook command for its trust check. So the first upgrade that rewrites the Codex
commands makes Codex ask once for a hooks review: open codex in the project and accept it. An
install made with `--codex-trust write` skips that, because upgrade recomputes the trusted hashes.

## Commands

- `crank-mem init` sets up the project. It wires hooks into `.claude` and `.codex`, seeds
  `.crank/` and runs the first scan.
  - **Claude settings:** it adds the `Bash(crank-mem search *)`, `Bash(crank-mem timeline *)`,
    `Bash(crank-mem get *)`, `Bash(crank-mem outline *)` and `Bash(crank-mem unfold *)` allow
    rules to the wired Claude settings file, so agents run the recall and code-reading commands
    without a prompt. It also removes crank hooks from the other Claude settings file.
  - **Options:** `--plan` lists every file init would create or change, and writes nothing.
    `--agents claude|codex|both` picks the wiring.
  - **Interruptions:** init journals itself. After an interrupted run, `init --resume` finishes
    it and `init --rollback` undoes it.
  - **Re-runs:** run again on a finished install, init reports its health and changes nothing.
- `crank-mem doctor` is a read-only health check of the machine and the project.
  - It checks the runtime, the packages, the optional parts, the vendored hooks, the Claude and
    Codex wiring, whether the git mode is in effect, the anatomy, the memory switches and any
    unfinished init.
  - Each failure names the command that fixes it, and doctor exits 1 only when one fails.
- `crank-mem scan` rebuilds the anatomy in full.
- `crank-mem digest on|off|resume` turns background digests on or off for this checkout. The
  switch is kept in the gitignored `.crank/config.local.json`. `resume` clears a stop and restarts
  the daemon.
- `crank-mem consolidate on|off` lets consolidation edit `cerebrum.md` after each digest, or
  stops it.
  - It is off by default.
  - The switch is kept beside `digest` in `.crank/config.local.json`, so a committed
    `config.json` cannot turn it on.
- `crank-mem search <query>` searches the store by meaning or keyword.
  - Options: `--limit`, `--type`, `--since YYYY-MM-DD` and `--file`.
  - `--stale` includes observations flagged stale, marked `[stale]`.
  - Search is keyword-only until `setup` has downloaded the model.
- `crank-mem timeline <id>` shows the observations around one id (`--depth`).
- `crank-mem get <id...>` prints stored observations in full, with the date and reason of any
  stale flag.
- `crank-mem outline <file>` prints a source file's symbols as folded source, with start-end line
  ranges and members under their class. A long outline ends with a `--from <line>` command for
  the next page.
- `crank-mem unfold <file> <symbol|line>` prints one symbol in full, with line numbers and its doc
  comment. It matches by bare or qualified name, or by any line inside the symbol; every match
  prints.
- `crank-mem restore-memory [<file>]` puts a `memory.db` snapshot back: the named file, or the
  newest one in `.crank/backups/memory/`.
  - It checks the snapshot's integrity and schema version.
  - It saves the current store as a snapshot first, so the restore can be undone.
  - It then migrates the restored store to this version.
- `crank-mem setup` installs the clone's packages, builds the dashboard into `dashboard/dist/`
  and downloads the local search model into `~/.crank/models`. `--core`, `--skip-dashboard`
  and `--skip-model` leave parts out.
- `crank-mem stats` reports on the project in four groups:
  - **Anatomy:** the index report.
  - **Memory health:**
    - cerebrum bullets injected, against the total
    - preferences left out
    - the oldest bullet left out
    - cited paths that still exist
    - days since the last audit
  - **Capture health:**
    - digest on, off or stopped
    - the daemon, and the spool's waiting and parked entries
    - the store's counts, the last digest, and the month's cost at list price
    - pending `proposals` and `stale` rows
    - the last `consolidation` and its outcome
    - the `last snapshot`
    - the embedder
  - **Codex:** whether Codex threads got the injection, and whether its hook trust is current.
- `crank-mem dashboard` serves a read-only memory dashboard on `127.0.0.1` until Ctrl-C, with
  each registered project's Memory, Curation, Health and Usage views.
  - It prints `crank-mem dashboard: http://127.0.0.1:<port>/?token=<token>` and opens that URL in
    the browser. The token, kept in `~/.crank/dashboard.json`, trades for a session cookie.
  - `--port <n>` picks the port (default `38700` plus your uid mod 100), and `--no-open` skips the
    browser.
  - It refuses until `setup` has built the dashboard.
- `crank-mem upgrade` brings a project up to the clone after a `git pull` or an install (see
  Upgrading). It also adds the project to `~/.crank/projects.json`, the registry the dashboard
  shows.
- `crank-mem uninstall` removes all wiring, and offers to restore backups.
  - `--restore` puts each project file crank-mem changed back as it was before crank-mem first
    changed it, and deletes the files crank-mem created. Files outside the project, such as
    `~/.codex/config.toml`, only lose crank-mem's entries.
  - `--delete-crank` deletes only the files crank-mem writes in `.crank/`, `memory.db` and its
    `-wal` and `-shm` files included. It removes the directory only when nothing else is left in
    it.
  - It exits 1, naming the file, when it cannot remove crank-mem's entries from a file: one that
    is not valid JSON, or one it cannot read or write.

## Layout under `.crank/`

- `anatomy-index.json`: the anatomy, as data.
- `anatomy.md`: the same anatomy, for people and agents to read.
- `cerebrum.md`: memory bullets, kept by consolidation.
- `cerebrum-archive.md`: the bullets consolidation removed or replaced, each with its reason.
  Never injected.
- `memory.db`: the store of digested observations. Kept out of git.
- `config.json`: the choices init recorded.
- `config.local.json`: the per-checkout `digest` and `consolidate` switches. Kept out of git.
- `install-journal.json`: present only while an init is running, or after one was interrupted.
- `hooks/`: the vendored hooks.
- `backups/`:
  - init and upgrade backups;
  - `backups/cerebrum/`: the last 5 copies of `cerebrum.md`, taken before each consolidation
    edit and before an upgrade replaces the 0.8.1 template preamble;
  - `backups/memory/`: the daily snapshots of `memory.db`.
- `usage.jsonl`: the always-on usage log. Kept out of git.
  - It writes one line per session start, subagent start and file read the hooks handle, and
    one per `search`, `timeline`, `get`, `outline` and `unfold` run.
  - At 4 MiB it rotates to `usage.1.jsonl`, replacing the older one.

A `journal.md` from an earlier release stays on disk, but nothing reads or writes it.

`.crank/.gitignore` is an allowlist. It ignores everything in `.crank/` except `config.json`,
`cerebrum.md`, `cerebrum-archive.md`, `journal.md`, `anatomy.md`, `anatomy-index.json` and
`hooks/`. So in commit mode, backups, the lock file, the debug log and files another tool writes
into `.crank/` stay out of git. `init` backs up a `.crank/.gitignore` that another tool wrote
before replacing it.

Per-user state lives in `~/.crank` (or `$CRANK_HOME`). That covers:

- the spool, the daemon's heartbeat and the stop state
- the search model
- `dashboard.json` and `projects.json`
- `setup.json`, which records the parts `setup` left out

## Subagents

Claude Code fires `SessionStart` only in the main session, so crank-mem wires `SubagentStart`
too. Each `general-purpose`, `Explore`, `Plan` and `workflow-subagent` subagent gets:

- a 2,048-byte cerebrum excerpt, split between preferences and the newest memory bullets;
- a pointer to `cerebrum.md`;
- a pointer to `crank-mem outline` and `unfold`;
- when the project has a readable `memory.db` or digests are running, a recall pointer to
  `crank-mem search`, `timeline` and `get`.

Custom and plugin agents get nothing. The parent session does not see it. See ADR 0007.

## Digests

`crank-mem digest on` turns digests on for one checkout of a project. It writes the switch to the
gitignored `.crank/config.local.json`, so a teammate's checkout or a linked worktree stays off
until someone runs it there.

Claude Code's Stop and SessionEnd hooks then drop an entry for the session into a per-user spool
under `~/.crank` (or `$CRANK_HOME`). crank-mem creates that directory at mode 0700; a directory
that already exists keeps its mode. The hooks also start a small detached daemon, one per user,
which runs one digest job at a time across all projects and exits when idle.

A job:

1. reads the session's new transcript records;
2. removes `<private>` and `<system-reminder>` blocks;
3. redacts secrets (always on, with no setting to turn it off);
4. asks Haiku for typed observations and a summary;
5. stores them in `.crank/memory.db`;
6. embeds them locally, for search by meaning.

Digests run the unmodified `claude` binary on your own Claude login; any other credential stops
them until `crank-mem digest resume`. The run gets only `HOME`, `USER`, `PATH`, `TMPDIR` and
`CLAUDE_CODE_MAX_RETRIES=0` from the environment, and no tools, hooks or MCP servers (ADR 0008).
`crank-mem stats` shows the month's digest cost at list price. Codex sessions are not digested.

Nothing asks the agent to keep memory, whether digests run or not. Session start injects no
cerebrum or journal protocol, and Stop and post-write add nothing the model sees (ADR 0010). A
`journal.md` from an earlier release stays on disk, unread.

A live session is digested too. The daemon digests it 2 hours after it first sees it, then 2 hours
after each digest of it, so a long session reaches memory before it ends.

A digest also proposes `cerebrum.md` bullets, and flags earlier observations the session showed
to be wrong or replaced. Search, session start and file history leave flagged observations out;
`crank-mem search --stale` includes them, and `crank-mem get` shows the flag.

### Consolidation

After a digest, consolidation runs when three things hold:

- `crank-mem consolidate on` was run in this checkout;
- the project has a `cerebrum.md`;
- something waits for it.

It runs at most once every 2 hours per project.

**What it reviews:**
- `cerebrum.md`
- up to 20 pending proposals
- up to 20 stale flags not yet reviewed
- the bullets whose cited files changed since the last consolidation that succeeded (before one
  has, since the bullet's own date)
- until the first one succeeds, the bullets citing a missing file

**The evidence.** crank-mem then gathers evidence from the files those bullets, proposals and
flags cite in backticks. It admits a file only when all three hold:
- the anatomy holds it, so the sensitive-file filter, hidden paths, excludes and git ignores all
  apply;
- its real path is inside the project;
- it is a regular file.

It redacts each file and sends line-numbered evidence, capped at 400 lines a file and 60,000
characters in all.

**The run.** A second `claude -p` run checks the work against that evidence only. It has no tools
and the same lockdown as a digest (ADR 0013).
- A memory proposal none of whose cited files is in the evidence is rejected as unverifiable,
  whatever the model answers.
- Otherwise the model accepts or rejects each proposal, confirms or clears each flag, and edits
  `cerebrum.md`.
- It skips any added bullet that would take the file past 150 lines or 3,000 tokens.
- Before an edit it copies the file to `.crank/backups/cerebrum/`.
- It appends each bullet it removes or replaces, with the reason, to `cerebrum-archive.md`.

### Snapshots and retention

Once a day, after a digest, crank-mem snapshots `memory.db` into `.crank/backups/memory/` and keeps
the newest 7 daily snapshots. `crank-mem restore-memory` puts one back.

The same daily pass deletes observations flagged stale more than 90 days ago. So a flag left
standing for 90 days ends that observation's retention.

## What gets indexed

Inside a git repository, the file list comes from `git ls-files -co --exclude-standard`, run from
the project root. So gitignored files stay out. That includes files the enclosing repository
ignores when the project is a subdirectory of one, such as `packages/web` in a monorepo.

**Order.** Two groups of files go first:
- files an agent wrote: up to 100, most recent first;
- the 100 files changed most often in the last 300 commits, not counting commits that touch more
  than 50 files. crank-mem recomputes this churn list only when HEAD moves.

Source code comes next. Anything under `deps_src`, `third_party`, `vendor`, `external`,
`node_modules`, `resources`, `assets`, `static` or `public` ranks last. The first `max_files`
(default 500) are indexed. A written file stays pinned until it shows up in the churn list.
`anatomy.md` opens with the 25 most active of these files.

**Exclusions:**
- Submodule contents are not indexed.
- A write to a gitignored file is indexed by the write hook, and dropped again at the next
  session start.
- A file reached through a symlink that leads outside the project is never indexed, whatever its
  name.

**Outside git, and when git fails:**
- Outside any git repository, a sorted directory walk is used instead.
- When git fails inside a repository, nothing new is indexed: the previous anatomy stays, rather
  than a walk that would ignore `.gitignore`.

**The cap.** When it cuts files, the session-start injection says so and, in git, gives the
indexed count against the total. `crank-mem stats` counts every indexable file without the cap.

## Audit skill

A bundled agent skill, `crank-mem-audit`, reconciles memory with reality:

1. It mines recent Claude Code and Codex sessions. It asks how many days back to check; the
   default is 5.
2. It verifies every cerebrum bullet against the current code.
3. It backs up and rewrites `cerebrum.md`.

Between audits, consolidation keeps the cerebrum after each digest (see Digests). Install the
skill into a project with the [skills CLI](https://github.com/vercel-labs/skills):

```sh
cd <your project> && npx skills add ChrisLiva/crank-mem
```

Install it at the **project level**: `.claude/skills/` for Claude Code, and the shared
`.agents/skills/` for Codex. User-level Codex paths are inconsistent between the docs and the
installer.

The installer writes a `skills-lock.json` at the project root, recording the source and content
hash. Update installed copies with `npx skills update`; `crank-mem upgrade` never touches them.

Invocation is user-only: `/crank-mem-audit` in Claude Code, `$crank-mem-audit` in Codex. An audit
is dated by its backup directory under `.crank/backups/`: the one that holds only copies of the
memory files, `cerebrum.md`, `journal.md` and `cerebrum-archive.md`.

## Debugging

Start with `crank-mem doctor`. It checks the install and the project without writing anything.

Hooks are advisory-only, and silent by design. Their stderr reaches only the terminal, never the
model, so a failing hook leaves no record in the project. When something looks wrong, turn on a
per-run JSONL trace:

```sh
CRANK_DEBUG=1                      # one session, no config edit
# or "debug": true in .crank/config.json, for every session
```

Either writes `.crank/debug.log`, one record per hook run:

```json
{"ts":"…","hook":"post-write","ms":5,"ok":true,"events":[
  {"event":"reindex","tool":"Write","paths":["src/app.ts"],"committed":true}]}
```

`ok:false` carries the full stack. Useful events:

- `refresh`: changed, added, removed and partial counts.
- `injected`: bytes against the budget, plus estimated tokens.
- `reindex`: `committed:false` means the write did not land.
- `lock-timeout`: contention, and the only way to tell it apart from "nothing to write".
- `walk-refused`: inside a git repository the listing failed, so nothing new was indexed rather
  than walking past `.gitignore`.
- `churn-skipped`: no churn list, for example before the first commit.

`CRANK_DEBUG=0` forces it off. The log is gitignored and capped at 1 MB, then restarted. It never
contains sensitive paths, and it can never fail a session: a write error is swallowed, like any
other advisory failure.

See `docs/adr/` for the probe-verified agent behavior this design rests on.
