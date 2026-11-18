import { afterAll, afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  REPO_ROOT,
  digestProject,
  fakeClaude,
  killDaemon,
  makeCrankHome,
  makeCrankProject,
  readDaemon,
  runHook,
  spoolFiles,
  waitFor,
} from "./helpers.ts";
import { claudeSessionEnd, claudeStop } from "./fixtures/payloads.ts";
import { crankHooks } from "../src/cli/settings.ts";

const STOP = "src/hooks/stop.ts";
const SESSION_END = "src/hooks/session-end.ts";
const TRANSCRIPT = "/x/abc-1.jsonl";

// Every daemon a hook starts here, so none outlives the suite.
const homes: string[] = [];
const daemonPids = new Set<number>();
function daemonPid(home: string): number | undefined {
  const pid = readDaemon(home)?.pid;
  if (typeof pid === "number") daemonPids.add(pid);
  return pid;
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
afterEach(async () => {
  for (const home of homes.splice(0)) {
    daemonPid(home);
    killDaemon(home);
  }
  for (const pid of daemonPids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
  await waitFor(() => [...daemonPids].every((pid) => !alive(pid)), 5_000);
});
afterAll(() => {
  for (const pid of daemonPids)
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
});

/** A crank home whose daemon afterEach kills, and a fake claude for any job that daemon runs. */
function daemonEnv(): { home: string; env: Record<string, string> } {
  const home = makeCrankHome();
  homes.push(home);
  const fake = fakeClaude(path.join(home, "fake-bin"), [{ raw: "", exit: 1 }]);
  return { home, env: { ...fake.env, CRANK_HOME: home } };
}
function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("hook-started daemon (black-box)", () => {
  // Added in our line (see ATTRIBUTION.md; CRK-R-hook-dotenv-isolation@1, Kate's second test):
  // a daemon started through the wired Stop command sees none of the project's .env files.
  // A fake clone's launcher dumps the environment the daemon would start with.
  test("a daemon the wired Stop hook starts inherits nothing from the project's .env files", async () => {
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), "crank-fakeclone-"));
    const dump = path.join(clone, "env.txt");
    fs.mkdirSync(path.join(clone, "bin"));
    // Written aside, then renamed: the test polls the file, and a large environment (CI) would
    // otherwise be read half-written.
    fs.writeFileSync(
      path.join(clone, "bin/crank-mem"),
      `#!/bin/sh\nenv > '${dump}.part' && mv '${dump}.part' '${dump}'\n`,
      {
        mode: 0o755,
      },
    );
    const root = digestProject({ clone_root: clone });
    fs.cpSync(path.join(REPO_ROOT, "src/hooks"), path.join(root, ".crank/hooks"), {
      recursive: true,
    });
    for (const name of [".env", ".env.local", ".env.production"])
      fs.writeFileSync(
        path.join(root, name),
        `CRANK_PROBE_${name.replace(/\W/g, "_")}=leaked\nCRANK_RELEASE_URL=http://127.0.0.1:9/hostile\n`,
      );
    const { env } = daemonEnv();
    const command = crankHooks("bun", "claude").Stop![0]!.hooks[0]!.command;
    const run = spawnSync("sh", ["-c", command], {
      cwd: root,
      input: JSON.stringify({ ...claudeStop(root), transcript_path: TRANSCRIPT }),
      encoding: "utf-8",
      timeout: 15_000,
      // helpers.ts sets CRANK_RELEASE_URL for every child; this child must start without it.
      env: Object.fromEntries(
        Object.entries({
          ...process.env,
          ...env,
          CLAUDE_PROJECT_DIR: root,
          NODE_ENV: "production",
        }).filter(([k]) => k !== "CRANK_RELEASE_URL"),
      ) as Record<string, string>,
    });
    expect(run.status).toBe(0);
    await waitFor(() => fs.existsSync(dump) && fs.readFileSync(dump, "utf-8").length > 0, 10_000);
    // Compare names only, so a failure never prints the environment.
    const names = fs
      .readFileSync(dump, "utf-8")
      .split("\n")
      .map((line) => line.split("=")[0]!);
    expect(names).toContain("CRANK_HOME");
    expect(names.filter((n) => n.startsWith("CRANK_PROBE_") || n === "CRANK_RELEASE_URL")).toEqual(
      [],
    );
  }, 20_000);

  test("a SessionEnd replaces a daemon whose heartbeat is older than 90 s", async () => {
    const root = digestProject({ clone_root: REPO_ROOT });
    const { home, env } = daemonEnv();
    const finished = spawnSync(process.execPath, ["-e", "0"]).pid;
    fs.writeFileSync(
      path.join(home, "daemon.json"),
      JSON.stringify({ pid: finished, version: "0.8.0", heartbeatMs: Date.now() - 120_000 }),
    );
    const run = runHook(SESSION_END, JSON.stringify(claudeSessionEnd(root, TRANSCRIPT)), root, env);
    expect(run.status).toBe(0);
    await waitFor(() => {
      const pid = daemonPid(home);
      return pid !== undefined && pid !== finished;
    }, 20_000);
    expect(alive(daemonPid(home)!)).toBe(true);
  }, 30_000);

  test("a stop file or digest off starts no daemon", async () => {
    const stopped = daemonEnv();
    fs.writeFileSync(
      path.join(stopped.home, "digest-state.json"),
      JSON.stringify({ reason: "login", atMs: 1, detail: "x" }),
    );
    const on = digestProject({ clone_root: REPO_ROOT });
    const payload = (root: string) =>
      JSON.stringify({ ...claudeStop(root), transcript_path: TRANSCRIPT });
    expect(runHook(STOP, payload(on), on, stopped.env).status).toBe(0);
    expect(spoolFiles(stopped.home)).toEqual(["abc-1.json"]);

    const off = daemonEnv();
    const offRoot = makeCrankProject();
    const file = path.join(offRoot, ".crank/config.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), clone_root: REPO_ROOT }),
    );
    expect(runHook(STOP, payload(offRoot), offRoot, off.env).status).toBe(0);
    expect(
      runHook(SESSION_END, JSON.stringify(claudeSessionEnd(offRoot, TRANSCRIPT)), offRoot, off.env)
        .status,
    ).toBe(0);

    await sleepMs(1_500);
    expect(fs.existsSync(path.join(stopped.home, "daemon.json"))).toBe(false);
    // A daemon would have swept the entry away, since its transcript does not exist.
    expect(spoolFiles(stopped.home)).toEqual(["abc-1.json"]);
    expect(fs.existsSync(path.join(off.home, "daemon.json"))).toBe(false);
    expect(fs.existsSync(path.join(off.home, "spool"))).toBe(false);
  }, 10_000);

  test.each([
    ["empty", ""],
    ["a missing directory", "/nonexistent/crank-mem-clone"],
  ])(
    "clone_root %s starts nothing, and the hook still signals",
    async (_label, cloneRoot) => {
      const root = digestProject({ clone_root: cloneRoot });
      const { home, env } = daemonEnv();
      const run = runHook(
        STOP,
        JSON.stringify({ ...claudeStop(root), transcript_path: TRANSCRIPT }),
        root,
        env,
      );
      expect(run.status).toBe(0);
      expect(run.stdout).toBe("");
      expect(spoolFiles(home)).toEqual(["abc-1.json"]);
      // ensureDaemon returns before spawn when clone_root names no clone.
      await sleepMs(200);
      expect(fs.existsSync(path.join(home, "daemon.json"))).toBe(false);
    },
    10_000,
  );
});
