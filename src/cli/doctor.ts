import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { CRANK_DIR, loadConfig, type CrankConfig } from "../hooks/lib/config.ts";
import { driftNote } from "../hooks/lib/drift.ts";
import { findProjectRoot } from "../hooks/lib/hook-io.ts";
import { insideGitRepo } from "../hooks/lib/activity.ts";
import { modelPresent } from "../daemon/embedder.ts";
import { codexTrustStatus, userCodexConfigPath } from "./codex-trust.ts";
import { claudeSettingsFiles, installPaths, modeIgnoreFile } from "./install-support.ts";
import { hasJournal, readJournal } from "./install-journal.ts";
import { detectRuntime } from "./runtime.ts";
import { hasCrankHooks } from "./settings.ts";
import { dashboardCurrent, dashboardDir, readSetupProfile } from "./setup.ts";
import { cliVersion, REPO_ROOT } from "./version.ts";

// ── `crank-mem doctor` (aegis/safety-fixes; see ATTRIBUTION.md) ───────────────────────────────
//
// A read-only health check. It writes nothing anywhere, which is why it can be run at any time,
// and why `init` reuses it when it finds an existing install. Each check returns one line:
//
//   ok    the thing is as crank-mem left it
//   warn  worth knowing, nothing broken (an optional part missing, a switch off)
//   FAIL  something is broken or half-done; the line ends with the command that fixes it
//
// Exit status: 1 when any check fails, else 0. Outside an initialized project only the machine
// checks run.

export type Level = "ok" | "warn" | "FAIL";
export interface Check {
  level: Level;
  name: string;
  detail: string;
}

const check = (level: Level, name: string, detail: string): Check => ({ level, name, detail });

/** Checks about this machine and the clone, independent of any project. */
export function machineChecks(): Check[] {
  const out: Check[] = [];
  const runtime = detectRuntime();
  out.push(
    runtime
      ? check("ok", "runtime", runtime)
      : check("FAIL", "runtime", "no bun and no node >= 23.6 on PATH; install one of them"),
  );
  out.push(check("ok", "crank-mem", `${cliVersion()} at ${REPO_ROOT}`));
  out.push(
    fs.existsSync(path.join(REPO_ROOT, "node_modules"))
      ? check("ok", "packages", "installed")
      : check("FAIL", "packages", "not installed; run `crank-mem setup --core`"),
  );
  const profile = readSetupProfile();
  if (!profile.dashboard)
    out.push(check("warn", "dashboard", "left out at setup; `crank-mem setup` adds it"));
  else
    out.push(
      dashboardCurrent(path.join(dashboardDir(), "dist"))
        ? check("ok", "dashboard", "built for this version")
        : check("warn", "dashboard", "not built for this version; run `crank-mem setup`"),
    );
  if (!profile.model)
    out.push(check("warn", "search model", "left out at setup; search is keyword-only"));
  else
    out.push(
      modelPresent()
        ? check("ok", "search model", "present")
        : check("warn", "search model", "missing; search is keyword-only until `crank-mem setup`"),
    );
  return out;
}

/** True when git ignores `rel` in `root`; null when git cannot say (no repo, git missing). */
function gitIgnores(root: string, rel: string): boolean | null {
  const r = spawnSync("git", ["check-ignore", "-q", "--", rel], { cwd: root, stdio: "ignore" });
  if (r.error) return null;
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null;
}

/** Checks about one initialized project rooted at `root`. */
export function projectChecks(root: string): Check[] {
  const crankDir = path.join(root, CRANK_DIR);
  const out: Check[] = [];

  if (hasJournal(crankDir)) {
    const j = readJournal(crankDir);
    out.push(
      check(
        "FAIL",
        "init",
        `an init${j ? ` started ${j.startedAt}` : ""} did not finish; run \`crank-mem init --resume\` or \`crank-mem init --rollback\``,
      ),
    );
  }
  if (!fs.existsSync(path.join(crankDir, "config.json"))) {
    out.push(check("FAIL", "config", "no .crank/config.json; run `crank-mem init`"));
    return out;
  }
  const config: CrankConfig = loadConfig(crankDir);

  const drift = driftNote(config);
  const vendored = fs.existsSync(path.join(crankDir, "hooks"));
  out.push(
    !vendored
      ? check("FAIL", "hooks", "no .crank/hooks/; run `crank-mem upgrade`")
      : drift
        ? check("FAIL", "hooks", drift)
        : check("ok", "hooks", `vendored at ${config.vendored_version}`),
  );

  const claudeSkipped = (config as unknown as Record<string, unknown>).claude === "skip";
  if (claudeSkipped) out.push(check("ok", "claude", "not wired (chosen at init)"));
  else {
    const { wired, other } = claudeSettingsFiles(root, config.git);
    const rel = (f: string) => path.relative(root, f);
    if (!hasCrankHooks(wired))
      out.push(
        check("FAIL", "claude", `no crank hooks in ${rel(wired)}; run \`crank-mem upgrade\``),
      );
    else if (hasCrankHooks(other))
      out.push(
        check(
          "FAIL",
          "claude",
          `hooks in both ${rel(wired)} and ${rel(other)} run twice; run \`crank-mem upgrade\``,
        ),
      );
    else out.push(check("ok", "claude", `hooks wired in ${rel(wired)}`));
  }

  const { codexHooks } = installPaths(root);
  if (config.codex === "skip" || config.codex === null)
    out.push(check("ok", "codex", "not wired (chosen at init)"));
  else if (!hasCrankHooks(codexHooks))
    out.push(
      check("FAIL", "codex", "no crank hooks in .codex/hooks.json; run `crank-mem upgrade`"),
    );
  else {
    const t = codexTrustStatus(userCodexConfigPath(), root, codexHooks);
    out.push(
      t.stale + t.missing === 0
        ? check("ok", "codex", "hooks wired and trusted")
        : check("warn", "codex", "hooks wired; open codex here once and accept the hooks review"),
    );
  }

  // Whether the chosen git mode is actually in effect (the monorepo case used to fail silently).
  if (!insideGitRepo(root)) {
    out.push(
      check("warn", "git", `mode ${config.git}, but the project is not inside a git repository`),
    );
  } else {
    const ignored = gitIgnores(root, `${CRANK_DIR}/cerebrum.md`);
    if (ignored === null) out.push(check("warn", "git", "git could not say what it ignores here"));
    else if (config.git === "commit")
      out.push(
        ignored
          ? check(
              "FAIL",
              "git",
              "commit mode, but git ignores .crank/cerebrum.md; run `crank-mem upgrade`",
            )
          : check("ok", "git", "commit mode: cerebrum.md is tracked"),
      );
    else
      out.push(
        ignored
          ? check("ok", "git", `${config.git} mode: .crank/ is kept out of git`)
          : check(
              "FAIL",
              "git",
              `${config.git} mode, but .crank/ is not ignored${modeIgnoreFile(root, config.git) ? "" : " (no ignore file found)"}; run \`crank-mem upgrade\``,
            ),
      );
  }

  out.push(
    fs.existsSync(path.join(crankDir, "anatomy-index.json"))
      ? check("ok", "index", "present")
      : check("FAIL", "index", "missing; run `crank-mem scan`"),
  );

  const switches = `digest ${config.digest ? "on" : "off"}, consolidate ${config.consolidate ? "on" : "off"}`;
  out.push(
    config.consolidate && !config.digest
      ? check("warn", "memory", `${switches}: consolidation waits for digests`)
      : check("ok", "memory", switches),
  );
  return out;
}

/** Print checks as aligned lines; returns true when none failed. */
export function printChecks(checks: Check[]): boolean {
  const width = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks)
    console.log(`  ${c.level.padEnd(4)}  ${c.name.padEnd(width)}  ${c.detail}`);
  return checks.every((c) => c.level !== "FAIL");
}

export async function run(_args: string[]): Promise<number> {
  console.log("crank-mem doctor");
  const machine = machineChecks();
  const root = findProjectRoot(process.cwd());
  const project = root ? projectChecks(root) : [];
  if (!root) {
    // An interrupted init can leave .crank/ without config.json, which findProjectRoot skips.
    const here = path.join(process.cwd(), CRANK_DIR);
    if (hasJournal(here)) project.push(...projectChecks(process.cwd()));
  }
  const healthy = printChecks([...machine, ...project]);
  if (!root && project.length === 0)
    console.log("  (not inside an initialized project: machine checks only)");
  return healthy ? 0 : 1;
}
