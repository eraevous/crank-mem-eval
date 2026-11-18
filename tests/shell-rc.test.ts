import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { addPathBlock, rcTarget, removePathBlocks } from "../src/cli/shell-rc.ts";

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

  // CRK-REQ-007 (Kate, round 5): the substitutions in the name must not run, shown by a sentinel file.
  test("sourcing it runs no command substitution named in the bin dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crank-rc-"));
    const bin = path.join(dir, "x `touch SENT_BQ` $(touch SENT_DS) it's", "bin");
    const rc = path.join(dir, "profile");
    fs.writeFileSync(rc, rcTarget("/bin/sh", "linux", dir).line(bin) + "\n");
    const run = spawnSync("sh", ["-c", `. "$1"; printf '%s' "$PATH"`, "sh", rc], {
      cwd: dir,
      encoding: "utf-8",
      env: { PATH: "/usr/bin:/bin" },
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`${bin}:/usr/bin:/bin`);
    expect(fs.existsSync(path.join(dir, "SENT_BQ"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "SENT_DS"))).toBe(false);
  });

  test("removal drops a block holding an odd bin dir and keeps the rest byte for byte", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "crank-rc-home-"));
    for (const [shell, rel] of [
      ["/bin/bash", ".bashrc"],
      ["/usr/bin/fish", ".config/fish/config.fish"],
    ] as const) {
      const target = rcTarget(shell, "linux", home);
      expect(target.file).toBe(path.join(home, rel));
      const before = "# mine\nalias ll='ls -l'\n";
      fs.mkdirSync(path.dirname(target.file), { recursive: true });
      fs.writeFileSync(target.file, before);
      addPathBlock(target.file, target.line(odd + "\\'"));
      expect(fs.readFileSync(target.file, "utf-8")).toContain("# >>> crank-mem >>>");
      expect(removePathBlocks(home)).toContain(target.file);
      expect(fs.readFileSync(target.file, "utf-8")).toBe(before);
    }
  });
});
