import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { REPO_ROOT } from "./helpers.ts";

// The Telosmith PostToolUse hook in .claude/settings.json runs aec for the project. Started
// inside the checkout, Python would import an aec.py, runpy.py or other module a branch adds
// there, ahead of the installed Telosmith, and run it as the developer (Codex security reviews
// on PR #7). The hook's `aec` shell function starts Python from `/` and passes the project as
// absolute paths. This test plants shadow modules that write a marker and checks the hook never
// runs one. It needs no Telosmith installed: with or without one, no shadow module may execute.

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
  for (const name of [
    "aec",
    "runpy",
    "os",
    "site",
    "sitecustomize",
    "encodings",
    "codecs",
    "io",
    "abc",
  ]) {
    fs.writeFileSync(path.join(project, `${name}.py`), shadow);
  }
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

test("python starts only outside the checkout", () => {
  const command = hookCommand();
  expect(command.match(/python3/g)?.length).toBe(1);
  expect(command).toContain("( cd / && python3 -m aec");
});
