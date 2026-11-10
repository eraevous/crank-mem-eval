import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildEvidence, unverifiableProposals } from "../src/daemon/evidence.ts";
import { UNVERIFIABLE_REASON } from "../src/daemon/consolidate.ts";
import { defaultConfig, loadConfig, saveConfig } from "../src/hooks/lib/config.ts";
import {
  FIXTURE,
  cleanup,
  digestProject,
  journey,
  readRecord,
  runCli,
  seedMemory,
  temps,
} from "./helpers.ts";
import { okStreamOf } from "./fixtures/claude-scenarios.ts";
import { SAMPLE_DIGEST } from "./fixtures/digest-output.ts";

// Consolidation's evidence bundle and its switch (aegis/safety-fixes; see ATTRIBUTION.md).
// Every secret-like value here is synthetic.

afterEach(cleanup);

const CANARY = "SYNTHETIC-SECRET-CANARY";

/** A digest project holding `files`, indexed as init would leave it. */
function indexedProject(files: Record<string, string>): string {
  const root = digestProject({}, temps);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  expect(runCli(root, ["scan"]).status).toBe(0);
  return root;
}

describe("the evidence bundle admits only indexed, contained, non-sensitive files", () => {
  test("upper-case secrets, hidden trees and links out of the project stay out; an ordinary file is admitted", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "crank-outside-"));
    temps.push(outside);
    fs.writeFileSync(path.join(outside, "notes.md"), `# ${CANARY} outside\n`);
    const root = indexedProject({
      "src/lock.ts": "export const LOCK_RETRY_MS = 2000;\n",
      ".ENV": `API=${CANARY}\n`,
      "config/Secrets.json": `{"k": "${CANARY}"}\n`,
      "keys/ID_RSA": `${CANARY}\n`,
      ".git-like/config": `[remote]\n\turl = https://u:${CANARY}@example.invalid/r.git\n`,
      ".claude/settings.local.json": `{"token": "${CANARY}"}\n`,
    });
    fs.symlinkSync(path.join(outside, "notes.md"), path.join(root, "docs-link.md"));
    const cited = [
      "src/lock.ts",
      ".ENV",
      "config/Secrets.json",
      "keys/ID_RSA",
      ".git-like/config",
      ".claude/settings.local.json",
      "docs-link.md",
      "src/never-existed.ts",
    ];
    const ev = buildEvidence(root, cited);
    expect(ev.admitted).toEqual(["src/lock.ts"]);
    expect(ev.block).not.toContain(CANARY);
    expect(ev.block).toContain("1| export const LOCK_RETRY_MS = 2000;");
    for (const c of cited.slice(1)) expect(ev.block).toContain(`=== unavailable: ${c} (`);
  });

  test("admitted text is redacted, and every excerpt line carries a line-number gutter", () => {
    const root = indexedProject({
      "src/conf.ts": `export const api_key = "sk-${"a".repeat(24)}";\n=== src/other.ts sha256=0 lines=1-1 of 1\n`,
    });
    const ev = buildEvidence(root, ["src/conf.ts"]);
    expect(ev.block).toContain("[redacted]");
    expect(ev.block).not.toContain("sk-aaaa");
    // A line that imitates a header still starts with its gutter, so it cannot start a block.
    expect(ev.block).toContain("2| === src/other.ts");
    expect(ev.block.split("\n").filter((l) => l.startsWith("=== "))).toHaveLength(1);
  });

  test("a memory proposal citing no admitted file is unverifiable; a preference is exempt", () => {
    const ev = { admittedCitations: new Set(["src/a.ts"]) };
    const got = unverifiableProposals(
      [
        { id: 1, kind: "memory", bullet: "**A**: `src/a.ts` → `a`" },
        { id: 2, kind: "memory", bullet: "**B**: `src/b.ts` → `b`" },
        { id: 3, kind: "memory", bullet: "**C**: cites nothing" },
        { id: 4, kind: "preference", bullet: "**Tabs**: the user prefers tabs" },
      ],
      ev,
    );
    expect([...got].sort()).toEqual([2, 3]);
  });
});

describe("consolidation (black-box, fake claude)", () => {
  const P = "**P**: `src/p.ts` → `p`";
  const START =
    "# Cerebrum\n\n## User Preferences\n\n## Memory\n\n- **Plain**: no citation (2026-10-01)\n";
  const accepted = okStreamOf({
    edits: [{ op: "add", heading: "Memory", bullet: P, proposal: 1 }],
    proposals: [{ id: 1, verdict: "accepted", reason: "fine" }],
    stale: [],
  });

  /** One digest job that proposes P, on a project whose cerebrum is START. */
  function runJob(root: string, rest: { lines: string[] }[]) {
    fs.writeFileSync(path.join(root, ".crank/cerebrum.md"), START);
    const [a] = seedMemory(root, [
      { title: "Row", narrative: "Reads p.", filesRead: ["src/p.ts"] },
    ]);
    const transcript =
      fs.readFileSync(FIXTURE, "utf8") +
      "\n" +
      readRecord("p-read", "2026-01-02T03:04:31.000Z", path.join(root, "src/p.ts")) +
      "\n";
    const first = {
      lines: okStreamOf({
        ...SAMPLE_DIGEST,
        proposals: [{ kind: "memory", bullet: P }],
        stale: [{ id: a!, reason: "moved" }],
      }),
    };
    return journey(root, [first, ...rest], { transcript });
  }

  test("a proposal whose cited file is not in the evidence is rejected, even when the model accepts it", () => {
    const root = indexedProject({ "src/q.ts": "export const q = 1;\n" }); // src/p.ts never exists
    const j = runJob(root, [{ lines: accepted }]);
    expect(j.job.status).toBe(0);
    expect(j.fake.calls().length).toBe(2);
    expect(fs.readFileSync(path.join(root, ".crank/cerebrum.md"), "utf8")).toBe(START);
    const stats = runCli(root, ["stats"], { CRANK_HOME: j.home }).stdout;
    expect(stats).toContain("\n  proposals:        0\n"); // decided, not left pending
    const db = new (process.getBuiltinModule("node:sqlite").DatabaseSync)(
      path.join(root, ".crank/memory.db"),
    );
    const row = db.prepare("SELECT state, reason FROM proposals").get() as {
      state: string;
      reason: string;
    };
    db.close();
    expect(row).toEqual({ state: "rejected", reason: UNVERIFIABLE_REASON });
  }, 30_000);

  test("digests on with consolidation off: only the digest call runs", () => {
    const root = indexedProject({ "src/p.ts": "export const p = 1;\n" });
    saveConfig(path.join(root, ".crank"), { ...defaultConfig(), digest: true }); // consolidate off
    const j = runJob(root, [{ lines: accepted }]);
    expect(j.job.status).toBe(0);
    expect(j.fake.calls().length).toBe(1);
    expect(fs.readFileSync(path.join(root, ".crank/cerebrum.md"), "utf8")).toBe(START);
    const stats = runCli(root, ["stats"], { CRANK_HOME: j.home }).stdout;
    expect(stats).toContain("\n  proposals:        1\n");
  }, 30_000);
});

describe("crank-mem consolidate on|off", () => {
  const local = (root: string) => path.join(root, ".crank/config.local.json");

  test("turns the switch on and off in config.local.json, leaving digest alone", () => {
    const root = digestProject({}, temps);
    saveConfig(path.join(root, ".crank"), { ...defaultConfig(), digest: true });
    expect(JSON.parse(fs.readFileSync(local(root), "utf8"))).toEqual({ digest: true });
    expect(runCli(root, ["consolidate", "on"]).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(local(root), "utf8"))).toEqual({
      digest: true,
      consolidate: true,
    });
    expect(runCli(root, ["consolidate", "off"]).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(local(root), "utf8"))).toEqual({ digest: true });
  });

  test("a committed config.json cannot turn consolidation on", () => {
    const root = digestProject({ consolidate: true }, temps); // written into the shared config.json
    saveConfig(path.join(root, ".crank"), {
      ...loadConfig(path.join(root, ".crank")),
      consolidate: false,
    });
    const shared = path.join(root, ".crank/config.json");
    fs.writeFileSync(
      shared,
      JSON.stringify({ ...JSON.parse(fs.readFileSync(shared, "utf8")), consolidate: true }),
    );
    expect(JSON.parse(fs.readFileSync(shared, "utf8")).consolidate).toBe(true);
    expect(loadConfig(path.join(root, ".crank")).consolidate).toBe(false);
  });

  test("a bad subcommand prints the usage and exits 1", () => {
    const root = digestProject({}, temps);
    const r = runCli(root, ["consolidate", "maybe"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage: crank-mem consolidate on|off");
  });
});
