// A project rooted in a subdirectory of a git repository (a monorepo package) has no .git of its
// own. Added in our line (see ATTRIBUTION.md); rebuilt on v0.16 from 3e76afe.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { Database } from "bun:sqlite";
import { git, gitCommit, makeProject, runCli, runHook, type CliRun } from "./helpers.ts";
import { claudeSessionStart } from "./fixtures/payloads.ts";

function cli(cwd: string, codexHome: string, ...args: string[]): CliRun {
  return runCli(cwd, args, { CODEX_HOME: codexHome });
}

function ignored(root: string, rel: string): boolean {
  return spawnSync("git", ["check-ignore", "-q", "--", rel], { cwd: root }).status === 0;
}

describe("monorepo subdirectory project", () => {
  test("exclude mode writes the enclosing repo's exclude file, so nothing in .crank/ is committable", () => {
    const { root, codexHome } = makeProject({ "packages/app/src/a.ts": "export const a = 1;\n" });
    const app = path.join(root, "packages/app");
    const init = cli(app, codexHome, "init", "--yes", "--git", "exclude", "--codex", "skip");
    expect(init.status).toBe(0);
    expect(init.stderr).not.toContain("not inside a git repository");
    expect(fs.readFileSync(path.join(root, ".git/info/exclude"), "utf-8")).toContain(".crank/");
    for (const rel of ["cerebrum.md", "config.json", "code.db"])
      expect(ignored(root, `packages/app/.crank/${rel}`)).toBe(true);
    expect(git(root, "status", "--porcelain", "-uall")).not.toContain(".crank/");
    expect(cli(app, codexHome, "uninstall", "--yes", "--keep-crank").status).toBe(0);
    expect(fs.readFileSync(path.join(root, ".git/info/exclude"), "utf-8")).not.toContain(".crank/");
  });

  test("the enclosing repo's .gitignore applies to the project's file listing", () => {
    const { root, codexHome } = makeProject({
      ".gitignore": "packages/app/local-notes.ts\n",
      "packages/app/src/a.ts": "export const a = 1;\n",
      "packages/app/local-notes.ts": "export const SYNTHETIC_IGNORED_CANARY = 1;\n",
      "packages/other/sibling.ts": "export const SYNTHETIC_SIBLING_CANARY = 1;\n",
    });
    const app = path.join(root, "packages/app");
    expect(cli(app, codexHome, "init", "--yes", "--git", "exclude", "--codex", "skip").status).toBe(
      0,
    );
    const anatomy = cli(app, codexHome, "anatomy");
    expect(anatomy.status).toBe(0);
    expect(anatomy.stdout).toContain("src/a.ts");
    expect(anatomy.stdout).not.toContain("local-notes.ts");
    expect(anatomy.stdout).not.toContain("SYNTHETIC_IGNORED_CANARY");
    // Only the project's subtree: not a sibling package, not the repository root's files.
    expect(anatomy.stdout).not.toContain("sibling.ts");
    expect(anatomy.stdout).not.toContain("SYNTHETIC_SIBLING_CANARY");
    expect(anatomy.stdout).not.toContain("README.md");
  });

  test("churn counts only the project's own files, under the paths its listing uses", () => {
    const { root, codexHome } = makeProject({
      "packages/app/src/hot.ts": "export const hot = 0;\n",
      "packages/other/busy.ts": "export const busy = 0;\n",
    });
    for (let i = 1; i <= 3; i++) {
      fs.writeFileSync(path.join(root, "packages/app/src/hot.ts"), `export const hot = ${i};\n`);
      fs.writeFileSync(path.join(root, "packages/other/busy.ts"), `export const busy = ${i};\n`);
      gitCommit(root, `c${i}`);
    }
    const app = path.join(root, "packages/app");
    expect(cli(app, codexHome, "init", "--yes", "--git", "exclude", "--codex", "skip").status).toBe(
      0,
    );
    // writeActivity, which stores the churn list, runs in the session-start hook.
    expect(
      runHook("src/hooks/session-start.ts", JSON.stringify(claudeSessionStart(app))).status,
    ).toBe(0);
    const db = new Database(path.join(app, ".crank/code.db"), { readonly: true });
    const ranked = db
      .query("SELECT path FROM files WHERE churn_rank IS NOT NULL ORDER BY churn_rank")
      .all() as { path: string }[];
    expect(ranked.map((r) => r.path)).toEqual(["src/hot.ts"]);
    const row = db.query("SELECT value FROM meta WHERE key = 'churn'").get() as { value: string };
    db.close();
    const churn = JSON.parse(row.value);
    expect(churn.paths).toEqual(["src/hot.ts"]);
  });

  test("exclude mode outside any git repository says it has nothing to write to", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "crank-nogit-"));
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "crank-codex-"));
    fs.writeFileSync(path.join(root, "a.ts"), "export const a = 1;\n");
    const init = cli(root, codexHome, "init", "--yes", "--git", "exclude", "--codex", "skip");
    expect(init.status).toBe(0);
    expect(init.stderr + init.stdout).toContain("not inside a git repository");
  });

  test("in a linked worktree, exclude mode writes the exclude file git resolves, not <root>/.git", () => {
    const { root, codexHome } = makeProject({ "packages/app/src/a.ts": "export const a = 1;\n" });
    gitCommit(root, "base");
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), "crank-wt-"));
    fs.rmdirSync(wt);
    git(root, "worktree", "add", "-q", "-b", "wt", wt);
    expect(fs.statSync(path.join(wt, ".git")).isFile()).toBe(true);
    const app = path.join(wt, "packages/app");
    const init = cli(app, codexHome, "init", "--yes", "--git", "exclude", "--codex", "skip");
    expect(init.status).toBe(0);
    const exclude = path.resolve(app, git(app, "rev-parse", "--git-path", "info/exclude").trim());
    expect(fs.readFileSync(exclude, "utf-8")).toContain(".crank/");
    expect(fs.existsSync(path.join(wt, ".git", "info"))).toBe(false);
    expect(git(wt, "status", "--porcelain", "-uall")).not.toContain(".crank/");
  });

  test("in a submodule, exclude mode writes the submodule's own exclude file", () => {
    const sub = makeProject({ "src/s.ts": "export const s = 1;\n" }).root;
    gitCommit(sub, "sub base");
    const { root, codexHome } = makeProject();
    gitCommit(root, "super base");
    git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "mods/sub");
    const mod = path.join(root, "mods/sub");
    expect(fs.statSync(path.join(mod, ".git")).isFile()).toBe(true);
    const init = cli(mod, codexHome, "init", "--yes", "--git", "exclude", "--codex", "skip");
    expect(init.status).toBe(0);
    expect(
      fs.readFileSync(path.join(root, ".git/modules/mods/sub/info/exclude"), "utf-8"),
    ).toContain(".crank/");
    expect(git(mod, "status", "--porcelain", "-uall")).not.toContain(".crank/");
  });
});
