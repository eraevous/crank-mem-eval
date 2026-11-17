import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { cleanup, makeCrankHome, makeCrankProject, runHook } from "./helpers.ts";
import {
  claudePostWrite,
  claudeSessionStart,
  codexApplyPatch,
  codexSessionStart,
} from "./fixtures/payloads.ts";
import { loadIndex } from "../src/hooks/lib/store.ts";

// ADR 0016 step 3 parity pins, written against the hooks before the hook half
// moved behind payload adapters (Kate, review round 1): which agent a payload
// names (Codex markers win over Claude-shaped fields; neither means Claude), and
// that the tool, not the agent, decides which paths a write or read carries.

afterEach(cleanup);

const START = "src/hooks/session-start.ts";
const WRITE = "src/hooks/post-write.ts";

function agentOf(payload: (root: string) => object): string {
  const root = makeCrankProject();
  const run = runHook(START, JSON.stringify(payload(root)), root, { CRANK_HOME: makeCrankHome() });
  expect(run.status).toBe(0);
  const lines = fs
    .readFileSync(path.join(root, ".crank/usage.jsonl"), "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return lines[0].agent;
}

describe("payload adapters: which agent sent it", () => {
  test("a Claude-shaped payload carrying a string turn_id is Codex", () => {
    expect(agentOf((r) => ({ ...claudeSessionStart(r), turn_id: "t-1" }))).toBe("codex");
  });

  test("a rollout- transcript is Codex without a turn_id", () => {
    expect(agentOf(codexSessionStart)).toBe("codex");
  });

  test("a rollout- name in a directory, not the file name, is not a Codex marker", () => {
    const payload = (r: string) => ({
      ...claudeSessionStart(r),
      transcript_path: "/u/rollout-dir/551be959.jsonl",
    });
    expect(agentOf(payload)).toBe("claude");
  });

  test("a non-string turn_id with a Claude transcript is Claude", () => {
    expect(agentOf((r) => ({ ...claudeSessionStart(r), turn_id: 7 }))).toBe("claude");
  });

  test("no markers at all is Claude, the fallback", () => {
    const bare = (r: string) => {
      const { transcript_path: _t, ...rest } = claudeSessionStart(r) as Record<string, unknown>;
      return rest;
    };
    expect(agentOf(bare)).toBe("claude");
  });
});

describe("payload adapters: the tool decides the paths", () => {
  function written(payload: (root: string) => object): string[] {
    const root = makeCrankProject({ "src/a.ts": "export const a = 1;\n" });
    const home = makeCrankHome();
    runHook(START, JSON.stringify(claudeSessionStart(root)), root, { CRANK_HOME: home });
    fs.writeFileSync(path.join(root, "src/b.ts"), "export const b = 2;\n");
    const run = runHook(WRITE, JSON.stringify(payload(root)), root, { CRANK_HOME: home });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
    return Object.keys(loadIndex(path.join(root, ".crank")).files).sort();
  }

  const patch = "*** Begin Patch\n*** Add File: src/b.ts\n+export const b = 2;\n*** End Patch";

  test("an apply_patch payload without Codex markers is still indexed", () => {
    const files = written((root) => {
      const { turn_id: _t, ...p } = codexApplyPatch(root, patch) as Record<string, unknown>;
      return { ...p, transcript_path: "/u/.claude/projects/-proj/x.jsonl" };
    });
    expect(files).toContain("src/b.ts");
  });

  test("a Write payload carrying Codex markers is still indexed", () => {
    const files = written((root) => ({
      ...claudePostWrite(root, path.join(root, "src/b.ts")),
      turn_id: "t-1",
    }));
    expect(files).toContain("src/b.ts");
  });

  test("malformed tool_input and an unknown tool exit 0 and index nothing new", () => {
    for (const p of [
      (root: string) => ({ ...claudePostWrite(root, "x"), tool_input: "nope" }),
      (root: string) => ({ ...codexApplyPatch(root, patch), tool_input: { command: 3 } }),
      (root: string) => ({ ...claudePostWrite(root, "src/b.ts"), tool_name: "Glob" }),
    ]) {
      expect(written(p)).not.toContain("src/b.ts");
    }
  });
});
