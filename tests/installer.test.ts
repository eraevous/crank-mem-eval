import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./helpers.ts";

// install.sh (aegis/safety-fixes; see ATTRIBUTION.md), run offline: it clones this checkout by
// path, and CRANK_INSTALL_SETUP stands in for `crank-mem setup` (`true` succeeds, `false` fails),
// so no package registry is reached. A real setup run is covered by setup.test.ts.

const SCRIPT = path.join(REPO_ROOT, "install.sh");
const git = (...args: string[]) =>
  spawnSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf-8" }).stdout.trim();

/** A temp HOME with the installer's prefix and bin dir inside it. */
function sandbox(): {
  home: string;
  prefix: string;
  bin: string;
  run(args: string[], setup?: string): { status: number | null; out: string };
} {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "crank-install-"));
  const prefix = path.join(home, ".local/share/crank-mem");
  const bin = path.join(home, ".local/bin");
  const run = (args: string[], setup = "true") => {
    const r = spawnSync("sh", [SCRIPT, ...args], {
      encoding: "utf-8",
      env: { ...process.env, HOME: home, CRANK_INSTALL_SETUP: setup, XDG_DATA_HOME: "" },
      timeout: 60_000,
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  return { home, prefix, bin, run };
}

const current = (prefix: string) => fs.readlinkSync(path.join(prefix, "current"));

describe("install.sh", () => {
  const head = git("rev-parse", "HEAD");
  const parent = git("rev-parse", "HEAD~1");

  test("installs a commit into its own version dir and links the command through current", () => {
    const s = sandbox();
    const r = s.run(["--repo", REPO_ROOT, "--ref", head]);
    expect(r.status).toBe(0);
    expect(current(s.prefix)).toBe(path.join(s.prefix, "versions", head));
    expect(fs.existsSync(path.join(s.prefix, "versions", head, ".crank-install-complete"))).toBe(
      true,
    );
    expect(fs.readlinkSync(path.join(s.bin, "crank-mem"))).toBe(
      path.join(s.prefix, "current/bin/crank-mem"),
    );
  });

  test("re-running the same commit reuses it", () => {
    const s = sandbox();
    expect(s.run(["--repo", REPO_ROOT, "--ref", head]).status).toBe(0);
    const again = s.run(["--repo", REPO_ROOT, "--ref", head]);
    expect(again.status).toBe(0);
    expect(again.out).toContain("already installed; reusing it");
  });

  test("an upgrade switches current and keeps the old version; --rollback switches back", () => {
    const s = sandbox();
    expect(s.run(["--repo", REPO_ROOT, "--ref", parent]).status).toBe(0);
    const up = s.run(["--repo", REPO_ROOT, "--ref", head]);
    expect(up.status).toBe(0);
    expect(up.out).toContain("crank-mem upgrade");
    expect(current(s.prefix)).toBe(path.join(s.prefix, "versions", head));
    expect(s.run(["--rollback"]).status).toBe(0);
    expect(current(s.prefix)).toBe(path.join(s.prefix, "versions", parent));
  });

  test("a failed setup leaves the current version in place", () => {
    const s = sandbox();
    expect(s.run(["--repo", REPO_ROOT, "--ref", parent]).status).toBe(0);
    const failed = s.run(["--repo", REPO_ROOT, "--ref", head], "false");
    expect(failed.status).toBe(1);
    expect(failed.out).toContain("was not switched");
    expect(current(s.prefix)).toBe(path.join(s.prefix, "versions", parent));
    expect(fs.existsSync(path.join(s.prefix, "versions", head, ".crank-install-complete"))).toBe(
      false,
    );
  });

  test("--sha refuses a ref that resolves to another commit, installing nothing", () => {
    const s = sandbox();
    const r = s.run(["--repo", REPO_ROOT, "--ref", head, "--sha", parent]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("nothing installed");
    expect(fs.existsSync(path.join(s.prefix, "current"))).toBe(false);
  });

  test("a crank-mem command it did not make is left alone", () => {
    const s = sandbox();
    fs.mkdirSync(s.bin, { recursive: true });
    fs.writeFileSync(path.join(s.bin, "crank-mem"), "#!/bin/sh\necho mine\n");
    const r = s.run(["--repo", REPO_ROOT, "--ref", head]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("not made by this installer");
    expect(fs.readFileSync(path.join(s.bin, "crank-mem"), "utf-8")).toBe("#!/bin/sh\necho mine\n");
  });

  test("--uninstall removes the install and its command, and leaves ~/.crank alone", () => {
    const s = sandbox();
    expect(s.run(["--repo", REPO_ROOT, "--ref", head]).status).toBe(0);
    fs.mkdirSync(path.join(s.home, ".crank"));
    fs.writeFileSync(path.join(s.home, ".crank/projects.json"), "[]\n");
    expect(s.run(["--uninstall", "--yes"]).status).toBe(0);
    expect(fs.existsSync(s.prefix)).toBe(false);
    expect(fs.existsSync(path.join(s.bin, "crank-mem"))).toBe(false);
    expect(fs.existsSync(path.join(s.home, ".crank/projects.json"))).toBe(true);
  });
});
