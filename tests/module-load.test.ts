import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { childEnv, REPO_ROOT } from "./helpers.ts";

// Each module the agent adapters are built from loads on its own in a fresh
// process. An import cycle back to the registry (src/cli/agents.ts) makes an
// adapter's load depend on which module came first: imported alone, the
// registry read the adapter before it was initialized (crank-mem-eval#14,
// Copilot review).

const MODULES = [
  "src/cli/agents/claude.ts",
  "src/cli/agents/codex.ts",
  "src/cli/codex-trust.ts",
  "src/cli/install-support.ts",
  "src/cli/settings.ts",
  "src/cli/agents.ts",
];

for (const rel of MODULES) {
  test(`${rel} loads first in a fresh process`, () => {
    const url = Bun.pathToFileURL(path.join(REPO_ROOT, rel)).href;
    const result = spawnSync(
      process.execPath,
      ["-e", `await import(${JSON.stringify(url)}); console.log("loaded")`],
      { cwd: REPO_ROOT, env: childEnv(), encoding: "utf-8", timeout: 20_000 },
    );
    expect(result.stderr).not.toContain("before initialization");
    expect(result.stdout.trim()).toBe("loaded");
    expect(result.status).toBe(0);
  });
}
