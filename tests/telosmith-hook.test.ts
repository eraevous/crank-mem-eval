import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { REPO_ROOT } from "./helpers.ts";

// The Telosmith PostToolUse hook in .claude/settings.json runs `python3 ... -m aec` after
// cd-ing into the project. Python puts the current directory first on the import path, so a
// branch that adds its own aec.py or aec/__main__.py would run as the developer (Codex
// security review on PR #7). The hook uses `python3 -P` (3.11+) so the checkout is never
// importable. This test plants a shadow aec package that writes a marker and checks the
// hook never runs it. It needs no Telosmith installed: with or without one, the shadow
// module must not execute.

function hookCommand(): string {
  const settings = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, ".claude/settings.json"), "utf8"),
  );
  return settings.hooks.PostToolUse[0].hooks[0].command;
}

test("the Telosmith hook never imports an aec module from the checkout", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "telosmith-hook-"));
  const marker = path.join(project, "shadow-ran");
  const shadow = `open(${JSON.stringify(marker)}, "w").write("ran")\nprint("--exit-code")\n`;
  fs.mkdirSync(path.join(project, "aec"));
  fs.writeFileSync(path.join(project, "aec", "__init__.py"), "");
  fs.writeFileSync(path.join(project, "aec", "__main__.py"), shadow);
  fs.writeFileSync(path.join(project, "aec.py"), shadow);
  try {
    spawnSync("bash", ["-c", hookCommand()], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: project, PYTHONPATH: "" },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(fs.existsSync(marker)).toBe(false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test("every aec call in the hook runs with python3 -P", () => {
  const command = hookCommand();
  expect(command).not.toMatch(/python3 -m aec/);
  expect((command.match(/python3 -P -m aec/g) ?? []).length).toBeGreaterThan(0);
});
