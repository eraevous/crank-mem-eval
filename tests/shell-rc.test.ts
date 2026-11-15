import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { rcTarget } from "../src/cli/shell-rc.ts";

// crank-mem-eval (Copilot review on PR #8): the PATH line keeps an odd bin dir as one literal entry.
describe("the PATH line in a shell startup file", () => {
  const odd = path.join(os.tmpdir(), "crank rc $HOME `echo x` it's", "bin");

  test("sh sourcing it gains exactly the bin dir, unexpanded and unsplit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crank-rc-"));
    const rc = path.join(dir, "profile");
    fs.writeFileSync(rc, rcTarget("/bin/sh", "linux", dir).line(odd) + "\n");
    const run = spawnSync("sh", ["-c", `. "$1"; printf '%s' "$PATH"`, "sh", rc], {
      encoding: "utf-8",
      env: { PATH: "/usr/bin:/bin" },
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`${odd}:/usr/bin:/bin`);
  });

  test("fish gets one single-quoted word with \\ and ' escaped", () => {
    expect(rcTarget("/usr/bin/fish", "linux", "/h").line("/a b/it's\\x")).toBe(
      "fish_add_path '/a b/it\\'s\\\\x'",
    );
  });
});
