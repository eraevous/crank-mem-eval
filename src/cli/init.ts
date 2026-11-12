import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "./args.ts";
import { COMMANDS } from "./commands.ts";
import { choose } from "./prompt.ts";
import { cliVersion, toolRoot } from "./version.ts";
import { printUpdateNotice } from "./updates.ts";
import { newBackupDir } from "./backups.ts";
import { applyInstall, printReport } from "./install.ts";
import { gitExcludeFile, installPaths, claudeSettingsFiles } from "./install-support.ts";
import { clearJournal, hasJournal, readJournal, writeJournal } from "./install-journal.ts";
import { printChecks, projectChecks } from "./doctor.ts";
import { repairInstall } from "./install.ts";
import { claudeSkipped } from "./install-agents.ts";
import { userCodexConfigPath } from "./codex-trust.ts";
import { crankHome } from "../hooks/lib/user-state.ts";
import { loadConfig } from "../hooks/lib/config.ts";
import {
  defaultConfig,
  saveConfig,
  CRANK_DIR,
  errorMessage,
  type CodexChoice,
  type CrankConfig,
} from "../hooks/lib/config.ts";
import { fullScan } from "../hooks/lib/scanner.ts";
import { commitIndex } from "../hooks/lib/store.ts";
import { CLI_LOCK_BUDGET_MS } from "../hooks/lib/lock.ts";
import { detectRuntime } from "./runtime.ts";

export async function run(args: string[]): Promise<number> {
  printUpdateNotice();
  const { flags } = parseArgs(args, COMMANDS.init.value);
  const yes = flags.yes === true;
  const root = process.cwd();
  const crankDir = path.join(root, CRANK_DIR);

  // ── Re-runs (aegis/safety-fixes; see ATTRIBUTION.md) ─────────────────────
  // init used to refuse any second run. Now: --rollback and --resume finish an interrupted init
  // from its journal; a journal with neither flag explains both; a finished install reports its
  // health (doctor's project checks) and changes nothing.
  if (flags.rollback === true) return rollback(root, crankDir);
  if (flags.resume === true) {
    const resumed = resume(root, crankDir);
    if (resumed !== "fresh") return resumed;
    // Interrupted before config.json: nothing outside .crank/ was touched, so start over.
  } else if (hasJournal(crankDir)) {
    const j = readJournal(crankDir);
    console.error(
      `crank-mem: an earlier init${j ? ` (started ${j.startedAt})` : ""} did not finish.\n` +
        "  Run `crank-mem init --resume` to finish it, or `crank-mem init --rollback` to undo it.",
    );
    return 1;
  } else if (fs.existsSync(path.join(crankDir, "config.json"))) {
    return reportExisting(root, crankDir);
  }

  const runtime = detectRuntime();
  if (!runtime) {
    console.error("crank-mem: no suitable runtime — install bun or node >= 23.6. Aborting.");
    return 1;
  }

  // ── Choices ──────────────────────────────────────────────────────────────
  // Strict choice flags: reject bad values before prompting or touching disk.
  const CHOICE_FLAGS = [
    ["git", ["commit", "ignore", "exclude"]],
    ["codex", ["merge", "skip"]],
    ["codex-trust", ["write", "skip"]],
  ] as const;
  for (const [name, choices] of CHOICE_FLAGS) {
    const value = flags[name];
    if (typeof value === "string" && !(choices as readonly string[]).includes(value)) {
      console.error(`crank-mem: invalid --${name} ${value} (expected: ${choices.join(" | ")})`);
      return 1;
    }
  }

  // --agents claude|codex|both picks the wiring in one flag; it must agree with --codex if given.
  const agents = typeof flags.agents === "string" ? flags.agents : null;
  if (agents !== null && !["claude", "codex", "both"].includes(agents)) {
    console.error(`crank-mem: invalid --agents ${agents} (expected: claude | codex | both)`);
    return 1;
  }
  if (agents !== null && typeof flags.codex === "string") {
    const wantsCodex = agents !== "claude";
    if (wantsCodex !== (flags.codex === "merge")) {
      console.error(`crank-mem: --agents ${agents} contradicts --codex ${flags.codex}`);
      return 1;
    }
  }
  if (agents !== null && typeof flags.codex !== "string")
    flags.codex = agents === "claude" ? "skip" : "merge";

  const gitMode: CrankConfig["git"] =
    typeof flags.git === "string"
      ? (flags.git as CrankConfig["git"])
      : yes
        ? "exclude"
        : await choose("Track .crank/ in git?", ["commit", "ignore", "exclude"], "exclude");

  const adrPath = typeof flags.adr === "string" ? flags.adr : "docs/adr";

  const codexHooksJson = installPaths(root).codexHooks;
  let codexMode: string;
  if (typeof flags.codex === "string") {
    codexMode = flags.codex;
  } else if (fs.existsSync(codexHooksJson)) {
    // Pre-existing .codex wiring is a conflict — default to leaving it alone.
    codexMode = yes
      ? "skip"
      : await choose(
          ".codex/hooks.json exists — merge crank hooks into it?",
          ["merge", "skip"],
          "skip",
        );
  } else {
    codexMode = "merge";
  }

  const codexTrust =
    typeof flags["codex-trust"] === "string"
      ? flags["codex-trust"]
      : yes
        ? "skip"
        : await choose(
            "Write Codex trusted_hash entries to ~/.codex/config.toml?",
            ["write", "skip"],
            "skip",
          );

  const config: CrankConfig & { codex: CodexChoice } = {
    ...defaultConfig(),
    adr_path: adrPath,
    git: gitMode,
    runtime,
    vendored_version: cliVersion(),
    clone_root: toolRoot(),
    codex: codexMode !== "merge" ? "skip" : codexTrust === "write" ? "trust" : "review",
    ...(agents === "codex" ? { claude: "skip" } : {}),
  };

  // --plan: say what would change, write nothing.
  if (flags.plan === true) {
    printPlan(root, config);
    return 0;
  }

  // ── Backup dir, journal, config, first scan, then every item ─────────────
  fs.mkdirSync(crankDir, { recursive: true });
  const backupDir = newBackupDir(crankDir);
  writeJournal(crankDir, { startedAt: new Date().toISOString(), backupDir, version: cliVersion() });

  // Each writer backs up its file just before writing it, so a partial failure
  // is recoverable through `uninstall --restore`; init prints that hint instead of rolling back.
  let scanned: ReturnType<typeof commitIndex>;
  let installed: ReturnType<typeof applyInstall>;
  try {
    scanned = commitIndex(crankDir, CLI_LOCK_BUDGET_MS, () => fullScan(root, config));
    saveConfig(crankDir, config);
    installed = applyInstall({ root, crankDir, config, backupDir: () => backupDir });
  } catch (err) {
    console.error(`crank-mem: ${errorMessage(err)}`);
    // uninstall needs .crank/config.json; before it exists nothing outside
    // .crank/ has been touched yet, so the honest hint is just to delete it.
    // The journal stays, so the next init, and doctor, know this one did not finish.
    console.error(
      "init failed partway — run `crank-mem init --rollback` to undo it, or fix the cause and run `crank-mem init --resume`.",
    );
    return 1;
  }
  clearJournal(crankDir);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`crank-mem ${cliVersion()} initialized (runtime: ${runtime}, git: ${gitMode})`);
  console.log(`  indexed ${scanned?.meta.fileCount ?? "?"} files → .crank/anatomy.md`);
  printReport(installed);
  console.log(`Next: start a Claude Code session here — project memory injects at session start.`);
  console.log(`Optional: install the audit skill — npx skills add ChrisLiva/crank-mem`);
  return 0;
}

// ── Re-run, resume, rollback and plan (aegis/safety-fixes; see ATTRIBUTION.md) ──────────────

/** A finished install: report its health and change nothing. Exit 0 when healthy. */
function reportExisting(root: string, crankDir: string): number {
  const config = loadConfig(crankDir);
  console.log(
    `crank-mem: already initialized here (git: ${config.git}, codex: ${config.codex ?? "skip"}); nothing changed.`,
  );
  const healthy = printChecks(projectChecks(root));
  if (!healthy) console.log("Repair: `crank-mem upgrade`.");
  console.log(
    "To change these choices: `crank-mem uninstall --restore`, then `crank-mem init` with new flags.",
  );
  return healthy ? 0 : 1;
}

/**
 * Finish an interrupted init. With config.json in place, re-run every install item's repair (each
 * is idempotent) and the first scan; "fresh" when the init stopped before config.json, so the
 * caller starts over (nothing outside .crank/ is written before config.json).
 */
function resume(root: string, crankDir: string): number | "fresh" {
  const j = readJournal(crankDir);
  if (!hasJournal(crankDir)) {
    console.error("crank-mem: nothing to resume — no interrupted init here.");
    return 1;
  }
  if (!fs.existsSync(path.join(crankDir, "config.json"))) {
    clearJournal(crankDir);
    return "fresh";
  }
  const loaded = loadConfig(crankDir);
  const config = { ...loaded, codex: loaded.codex ?? ("skip" as const) };
  const backupDir = j?.backupDir ?? newBackupDir(crankDir);
  try {
    commitIndex(crankDir, CLI_LOCK_BUDGET_MS, () => fullScan(root, config));
    const r = repairInstall({ root, crankDir, config, backupDir: () => backupDir });
    printReport(r);
    if (r.failed) {
      console.error("crank-mem: resume could not finish every step; the journal stays.");
      return 1;
    }
  } catch (err) {
    console.error(`crank-mem: ${errorMessage(err)}`);
    return 1;
  }
  clearJournal(crankDir);
  console.log(`crank-mem ${cliVersion()}: the interrupted init is finished.`);
  return 0;
}

/**
 * Undo an interrupted (or any) init. With config.json, this is `uninstall --restore --delete-crank`:
 * every file init changed goes back to its first backup, and the files it created go. Without
 * config.json only .crank/ was touched, so only the files init writes before it are removed.
 */
async function rollback(root: string, crankDir: string): Promise<number> {
  const j = readJournal(crankDir);
  clearJournal(crankDir);
  if (fs.existsSync(path.join(crankDir, "config.json"))) {
    const uninstall = await import("./uninstall.ts");
    return uninstall.run(["--restore", "--delete-crank", "--yes"]);
  }
  if (!fs.existsSync(crankDir)) {
    console.log("crank-mem: nothing to roll back here.");
    return 0;
  }
  for (const f of ["anatomy-index.json", "anatomy.md", "anatomy-index.lock"])
    fs.rmSync(path.join(crankDir, f), { force: true });
  if (j) fs.rmSync(j.backupDir, { recursive: true, force: true });
  for (const d of ["backups", ""]) {
    try {
      fs.rmdirSync(path.join(crankDir, d)); // only when empty: anything else stays
    } catch {}
  }
  console.log("crank-mem: rolled back the unfinished init.");
  return 0;
}

/** --plan: each file init would create or change, and why. Writes nothing. */
function printPlan(root: string, config: CrankConfig & { codex: CodexChoice }): void {
  const show = (f: string) => {
    const r = path.relative(root, f);
    return r.startsWith("..") || path.isAbsolute(r) ? f : r;
  };
  const line = (f: string, why: string) =>
    console.log(`  ${fs.existsSync(f) ? "modify" : "create"}  ${show(f)}  (${why})`);
  const paths = installPaths(root);
  console.log(
    `crank-mem init --plan (git: ${config.git}, codex: ${config.codex}); nothing written.`,
  );
  line(
    path.join(root, CRANK_DIR),
    "config, index, cerebrum.md, vendored hooks, allowlist .gitignore",
  );
  if (!claudeSkipped(config)) {
    const { wired, other } = claudeSettingsFiles(root, config.git);
    line(wired, "Claude Code hooks and the recall allow rules");
    if (fs.existsSync(other))
      console.log(`  check   ${show(other)}  (crank hooks found here move to the file above)`);
  }
  if (config.codex !== "skip") {
    line(paths.codexHooks, "Codex hooks");
    line(paths.codexConfig, "Codex [features] hooks switch");
    if (config.codex === "trust") line(userCodexConfigPath(), "Codex trusted_hash entries");
  }
  if (config.git === "ignore") line(paths.gitignore, "the .crank/ ignore block");
  else if (config.git === "exclude") {
    const ex = gitExcludeFile(root);
    if (ex) line(ex, "the .crank/ ignore block");
    else console.log("  none    (exclude mode: not inside a git repository, nothing to write)");
  } else
    console.log(
      "  check   git ignore files  (commit mode removes a crank-mem block that hides cerebrum.md)",
    );
  line(path.join(crankHome(), "projects.json"), "the per-user project list the dashboard shows");
}
