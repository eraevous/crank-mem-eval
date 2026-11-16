import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, makeCrankHome, makeProject, withEnv } from "./helpers.ts";
import { cliVersion, REPO_ROOT as CLONE_ROOT } from "../src/cli/version.ts";
import { newBackupDir } from "../src/cli/backups.ts";
import { applyInstall, removeInstall, repairInstall, resolveCodex } from "../src/cli/install.ts";
import { crankHooks } from "../src/cli/settings.ts";
import { defaultConfig, loadConfig, saveConfig } from "../src/hooks/lib/config.ts";
import { AGENT_NAMES } from "../src/hooks/lib/agents.ts";

// Parity pins for ADR 0016 step 2 (the CLI half moves behind the agent adapters).
// Written before the move, from the code as it stood, so the move must leave
// every byte the same: the hook map per agent and runtime, and the report lines
// and wired files of install → repair → repair → remove for each agent choice.
// Regenerate only on a deliberate behavior change: CRANK_UPDATE_GOLDEN=1.

const GOLDEN = path.join(REPO_ROOT, "tests/fixtures/golden/agent-parity.json");

type Choice = "skip" | "review" | "trust";
type Case = { name: string; claude: "wire" | "skip"; codex: Choice };

const CASES: Case[] = [
  ...(["skip", "review", "trust"] as const).map((codex) => ({
    name: `claude+codex:${codex}`,
    claude: "wire" as const,
    codex,
  })),
  ...(["review", "trust"] as const).map((codex) => ({
    name: `codex-only:${codex}`,
    claude: "skip" as const,
    codex,
  })),
];

type Run = {
  initLines: string[];
  files: Record<string, string | null>;
  repairAfterDamage: string[];
  repairAgain: string[];
  removeLines: string[];
  filesAfterRemove: Record<string, string | null>;
};

const WATCHED = [".claude/settings.local.json", ".codex/hooks.json", ".codex/config.toml"];

function runCase(c: Case): Run {
  const made = makeProject();
  const root = fs.realpathSync(made.root);
  const codexHome = made.codexHome;
  const crankDir = path.join(root, ".crank");
  const home = makeCrankHome();
  const norm = (s: string) => s.split(root).join("<root>").split(codexHome).join("<codex>");
  const read = (f: string) => (fs.existsSync(f) ? norm(fs.readFileSync(f, "utf-8")) : null);
  const files = () => {
    const out: Record<string, string | null> = {};
    for (const rel of WATCHED) out[rel] = read(path.join(root, rel));
    out["<codex>/config.toml"] = read(path.join(codexHome, "config.toml"));
    return out;
  };
  return withEnv({ CRANK_HOME: home, CODEX_HOME: codexHome }, () => {
    fs.mkdirSync(crankDir, { recursive: true });
    const config = {
      ...defaultConfig(),
      git: "ignore" as const,
      runtime: "bun" as const,
      vendored_version: cliVersion(),
      clone_root: CLONE_ROOT,
      codex: c.codex,
      ...(c.claude === "skip" ? { claude: "skip" } : {}),
    };
    saveConfig(crankDir, config);
    const dir = newBackupDir(crankDir);
    const init = applyInstall({ root, crankDir, config, backupDir: () => dir });
    const afterInit = files();

    // Damage every agent file the wiring owns, so repair has to redo all of it.
    for (const rel of WATCHED) fs.rmSync(path.join(root, rel), { force: true });
    fs.writeFileSync(path.join(codexHome, "config.toml"), 'model = "gpt-5.6"\n');

    const repair = () => {
      let d: string | null = null;
      return repairInstall({
        root,
        crankDir,
        config: { ...loadConfig(crankDir), codex: resolveCodex(root, loadConfig(crankDir)) },
        backupDir: () => (d ??= newBackupDir(crankDir)),
      });
    };
    const first = repair();
    const second = repair();
    const removed = removeInstall({ root, crankDir, config: loadConfig(crankDir) });
    return {
      initLines: init.lines.map(norm),
      files: afterInit,
      repairAfterDamage: first.lines.map(norm),
      repairAgain: second.lines.map(norm),
      removeLines: removed.lines.map(norm),
      filesAfterRemove: files(),
    };
  });
}

function current(): Record<string, unknown> {
  const hooks: Record<string, unknown> = {};
  for (const agent of AGENT_NAMES)
    for (const runtime of ["bun", "node"] as const)
      hooks[`${agent}/${runtime}`] = crankHooks(runtime, agent);
  const runs: Record<string, Run> = {};
  for (const c of CASES) runs[c.name] = runCase(c);
  return { hooks, runs };
}

test("agent hook maps and install → repair → remove match the pre-adapter golden (ADR 0016)", () => {
  const got = current();
  if (process.env.CRANK_UPDATE_GOLDEN === "1")
    fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 2) + "\n");
  const want = JSON.parse(fs.readFileSync(GOLDEN, "utf-8")) as Record<string, unknown>;
  expect(got).toEqual(want);
});

test("a second repair changes nothing for any agent choice", () => {
  const want = JSON.parse(fs.readFileSync(GOLDEN, "utf-8")) as { runs: Record<string, Run> };
  for (const c of CASES) expect(want.runs[c.name]!.repairAgain).toEqual([]);
});
