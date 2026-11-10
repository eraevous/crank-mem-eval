import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeProject, runCli } from "./helpers.ts";

// `crank-mem doctor` (aegis/safety-fixes; see ATTRIBUTION.md): read-only, one line per check,
// exit 1 only when a check fails.

/** Every file under `dir` with its bytes, for proving that doctor wrote nothing. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const item of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, item.name);
      if (item.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full, "latin1");
    }
  };
  walk(dir);
  return out;
}

function inited(): { root: string; codexHome: string; env: Record<string, string> } {
  const { root, codexHome } = makeProject();
  const env = { CODEX_HOME: codexHome };
  expect(runCli(root, ["init", "--yes", "--codex", "skip"], env).status).toBe(0);
  return { root, codexHome, env };
}

describe("doctor", () => {
  test("a healthy install passes every project check, exits 0, and writes nothing", () => {
    const { root, env } = inited();
    const before = tree(root);
    const r = runCli(root, ["doctor"], env);
    expect(r.status).toBe(0);
    for (const name of ["hooks", "claude", "codex", "git", "index", "memory"])
      expect(r.stdout).toMatch(new RegExp(`^ {2}ok {4}${name}\\b`, "m"));
    expect(r.stdout).not.toContain("FAIL");
    expect(tree(root)).toEqual(before);
  });

  test("outside a project it runs only the machine checks", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crank-nowhere-"));
    const r = runCli(dir, ["doctor"]);
    expect(r.stdout).toContain("machine checks only");
    expect(r.stdout).toMatch(/^ {2}ok {4}runtime/m);
    expect(r.stdout).not.toMatch(/^ {2}\S+ +claude/m);
  });

  test("lost Claude wiring and a lost ignore block each FAIL with the fixing command", () => {
    const { root, env } = inited();
    fs.writeFileSync(path.join(root, ".claude/settings.local.json"), "{}\n");
    fs.writeFileSync(path.join(root, ".git/info/exclude"), "");
    const r = runCli(root, ["doctor"], env);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^ {2}FAIL {2}claude .*crank-mem upgrade/m);
    expect(r.stdout).toMatch(/^ {2}FAIL {2}git .*not ignored.*crank-mem upgrade/m);
    expect(runCli(root, ["upgrade"], env).status).toBe(0);
    expect(runCli(root, ["doctor"], env).status).toBe(0);
  });

  test("hooks wired in both Claude settings files FAIL, since every hook would run twice", () => {
    const { root, env } = inited();
    fs.copyFileSync(
      path.join(root, ".claude/settings.local.json"),
      path.join(root, ".claude/settings.json"),
    );
    const r = runCli(root, ["doctor"], env);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^ {2}FAIL {2}claude .*run twice/m);
  });

  test("consolidation on with digests off is a warning, not a failure", () => {
    const { root, env } = inited();
    expect(runCli(root, ["consolidate", "on"], env).status).toBe(0);
    const r = runCli(root, ["doctor"], env);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^ {2}warn {2}memory .*consolidation waits for digests/m);
  });
});
