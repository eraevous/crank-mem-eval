import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { git, gitCommit, makeCrankProject, runCli, runHook } from "./helpers.ts";
import {
  claudePostWrite,
  claudePostEdit,
  codexApplyPatch,
  claudeSessionStart,
} from "./fixtures/payloads.ts";
import { parseApplyPatch } from "../src/hooks/lib/apply-patch.ts";
import { loadIndex } from "../src/hooks/lib/store.ts";
import { defaultConfig, saveConfig } from "../src/hooks/lib/config.ts";

const HOOK = "src/hooks/post-write.ts";

function seedIndex(root: string): void {
  // Run session-start once to build the initial index.
  runHook("src/hooks/session-start.ts", JSON.stringify(claudeSessionStart(root)));
}

describe("parseApplyPatch", () => {
  test("parses Add, Update, Delete", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: /abs/path/greeting.txt",
      "+hello",
      "*** Update File: src/main.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "*** Delete File: old.ts",
      "*** End Patch",
    ].join("\n");
    expect(parseApplyPatch(patch)).toEqual([
      { path: "/abs/path/greeting.txt", deleted: false },
      { path: "src/main.ts", deleted: false },
      { path: "old.ts", deleted: true },
    ]);
  });
  test("garbage patch yields no ops", () => {
    expect(parseApplyPatch("not a patch")).toEqual([]);
  });
  test("Move to: old path dropped, new path indexed", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/old-name.ts",
      "*** Move to: src/new-name.ts",
      "*** End Patch",
    ].join("\n");
    expect(parseApplyPatch(patch)).toEqual([
      { path: "src/old-name.ts", deleted: true },
      { path: "src/new-name.ts", deleted: false },
    ]);
  });
});

describe("post-write hook (black-box)", () => {
  test("Claude Write: new file gets indexed, stdout silent", () => {
    const root = makeCrankProject({ "a.ts": "const a = 1;" });
    seedIndex(root);
    const newFile = path.join(root, "src/new.ts");
    fs.mkdirSync(path.dirname(newFile), { recursive: true });
    fs.writeFileSync(newFile, "/** Brand new module. */\nexport const n = 1;\n");

    const run = runHook(HOOK, JSON.stringify(claudePostWrite(root, newFile)));
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
    const index = loadIndex(path.join(root, ".crank"));
    expect(index.files["src/new.ts"]!.description).toBe("Brand new module.");
  });

  test("a written file past max_files stays indexed at the next session start", () => {
    const root = makeCrankProject({ "a.ts": "const a = 1;", "b.ts": "const b = 1;" });
    saveConfig(path.join(root, ".crank"), { ...defaultConfig(), max_files: 2 });
    seedIndex(root);
    fs.writeFileSync(path.join(root, "z.ts"), "/** Zed. */\n");
    expect(
      runHook(HOOK, JSON.stringify(claudePostWrite(root, path.join(root, "z.ts")))).status,
    ).toBe(0);
    runHook(HOOK, JSON.stringify(claudePostEdit(root, path.join(root, "z.ts"))));
    expect(loadIndex(path.join(root, ".crank")).files["z.ts"]!.writeCount).toBe(2);
    seedIndex(root);
    const index = loadIndex(path.join(root, ".crank"));
    expect(Object.keys(index.files).sort()).toEqual(["a.ts", "z.ts"]);
    expect(fs.readFileSync(path.join(root, ".crank/anatomy.md"), "utf-8")).toContain(
      "## Most active files\n\n- `z.ts` — Zed.",
    );
  });

  test("a write pin clears once the file is in the churn list", () => {
    const root = makeCrankProject({ "a.ts": "const a = 1;" });
    git(root, "init", "-q");
    seedIndex(root);
    fs.writeFileSync(path.join(root, "z.ts"), "export const z = 1;\n");
    runHook(HOOK, JSON.stringify(claudePostWrite(root, path.join(root, "z.ts"))));
    expect(loadIndex(path.join(root, ".crank")).files["z.ts"]!.writeCount).toBe(1);
    gitCommit(root, "z");
    seedIndex(root);
    const index = loadIndex(path.join(root, ".crank"));
    expect(index.meta.churn!.paths).toContain("z.ts");
    expect(index.files["z.ts"]!.writeCount).toBeUndefined();
    // Later writes to a churned file add no pin either.
    runHook(HOOK, JSON.stringify(claudePostEdit(root, path.join(root, "z.ts"))));
    expect(loadIndex(path.join(root, ".crank")).files["z.ts"]!.writeCount).toBeUndefined();
  });

  test("Claude Edit: existing file re-indexed", () => {
    const root = makeCrankProject({ "a.ts": "const a = 1;" });
    seedIndex(root);
    fs.writeFileSync(path.join(root, "a.ts"), "/** Updated alpha. */\nconst a = 2;\n");
    const run = runHook(HOOK, JSON.stringify(claudePostEdit(root, path.join(root, "a.ts"))));
    expect(run.status).toBe(0);
    expect(loadIndex(path.join(root, ".crank")).files["a.ts"]!.description).toBe("Updated alpha.");
  });

  test("Codex apply_patch: Add and Update re-indexed, Delete dropped", () => {
    const root = makeCrankProject({ "keep.ts": "const k = 1;", "gone.ts": "const g = 1;" });
    seedIndex(root);
    expect(loadIndex(path.join(root, ".crank")).files["gone.ts"]).toBeDefined();

    fs.writeFileSync(path.join(root, "added.ts"), "/** Added by codex. */\nexport const x = 1;\n");
    fs.writeFileSync(path.join(root, "keep.ts"), "/** Keep updated. */\nconst k = 2;\n");
    fs.unlinkSync(path.join(root, "gone.ts"));

    const patch = [
      "*** Begin Patch",
      `*** Add File: ${path.join(root, "added.ts")}`,
      "+x",
      "*** Update File: keep.ts",
      "+k",
      "*** Delete File: gone.ts",
      "*** Update File: .crank/cerebrum.md",
      "+x",
      "*** End Patch",
    ].join("\n");
    const run = runHook(HOOK, JSON.stringify(codexApplyPatch(root, patch)));
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
    const index = loadIndex(path.join(root, ".crank"));
    expect(index.files["added.ts"]!.description).toBe("Added by codex.");
    expect(index.files["keep.ts"]!.description).toBe("Keep updated.");
    expect(index.files["gone.ts"]).toBeUndefined();
  });

  test("a write refreshes the file's imports, from Claude and from Codex apply_patch", () => {
    const root = makeCrankProject({
      "src/a.ts": 'import "./b";\n',
      "src/b.ts": "export const b = 1;\n",
      "src/c.ts": "export const c = 1;\n",
    });
    expect(runCli(root, ["scan"]).status).toBe(0);
    const imports = () => loadIndex(path.join(root, ".crank")).files["src/a.ts"]!.imports;
    expect(imports()).toEqual(["src/b.ts"]);

    fs.writeFileSync(path.join(root, "src/a.ts"), 'import "./c";\n');
    const claude = runHook(
      HOOK,
      JSON.stringify(claudePostWrite(root, path.join(root, "src/a.ts"))),
    );
    expect(claude.status).toBe(0);
    expect(claude.stdout).toBe("");
    expect(imports()).toEqual(["src/c.ts"]);

    fs.writeFileSync(path.join(root, "src/a.ts"), 'import "./b";\n');
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "@@",
      '-import "./c";',
      '+import "./b";',
      "*** End Patch",
    ].join("\n");
    const codex = runHook(HOOK, JSON.stringify(codexApplyPatch(root, patch)));
    expect(codex.status).toBe(0);
    expect(codex.stdout).toBe("");
    expect(imports()).toEqual(["src/b.ts"]);
  });

  // ── Containment (aegis/safety-fixes; see ATTRIBUTION.md) ──────────────────────────────
  // A write to a path that is inside the project by name but resolves outside it must not put
  // the outside file's description, size or symbols into the index.

  /** A temp dir beside the project, holding a file whose first line is a recognisable canary. */
  function outsideDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crank-outside-"));
    fs.writeFileSync(path.join(dir, "private.md"), "# SYNTHETIC-OUTSIDE-CANARY\nbody\n");
    return dir;
  }

  test("a symlinked file pointing outside the project is not indexed", () => {
    const root = makeCrankProject({ "a.ts": "const a = 1;" });
    seedIndex(root);
    const outside = outsideDir();
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.symlinkSync(path.join(outside, "private.md"), path.join(root, "docs/notes.md"));
    const run = runHook(
      HOOK,
      JSON.stringify(claudePostWrite(root, path.join(root, "docs/notes.md"))),
    );
    expect(run.status).toBe(0);
    const index = loadIndex(path.join(root, ".crank"));
    expect(index.files["docs/notes.md"]).toBeUndefined();
    expect(JSON.stringify(index)).not.toContain("SYNTHETIC-OUTSIDE-CANARY");
  });

  test("a file reached through a symlinked directory outside the project is not indexed", () => {
    const root = makeCrankProject({ "a.ts": "const a = 1;" });
    seedIndex(root);
    const outside = outsideDir();
    fs.symlinkSync(outside, path.join(root, "linked"), "dir");
    const run = runHook(
      HOOK,
      JSON.stringify(claudePostWrite(root, path.join(root, "linked/private.md"))),
    );
    expect(run.status).toBe(0);
    const index = loadIndex(path.join(root, ".crank"));
    expect(index.files["linked/private.md"]).toBeUndefined();
    expect(JSON.stringify(index)).not.toContain("SYNTHETIC-OUTSIDE-CANARY");
  });

  test("a harmless-named link to a sensitive file inside the project is not indexed", () => {
    const root = makeCrankProject({
      "a.ts": "const a = 1;",
      "keys/id_rsa": "SYNTHETIC-KEY-CANARY\n",
    });
    seedIndex(root);
    fs.symlinkSync(path.join(root, "keys/id_rsa"), path.join(root, "readme.md"));
    runHook(HOOK, JSON.stringify(claudePostWrite(root, path.join(root, "readme.md"))));
    const index = loadIndex(path.join(root, ".crank"));
    expect(index.files["readme.md"]).toBeUndefined();
    expect(JSON.stringify(index)).not.toContain("SYNTHETIC-KEY-CANARY");
  });

  test("a symlink to an ordinary file inside the project is still indexed", () => {
    const root = makeCrankProject({ "a.ts": "const a = 1;", "src/real.md": "# Inside heading\n" });
    seedIndex(root);
    fs.symlinkSync(path.join(root, "src/real.md"), path.join(root, "alias.md"));
    runHook(HOOK, JSON.stringify(claudePostWrite(root, path.join(root, "alias.md"))));
    const index = loadIndex(path.join(root, ".crank"));
    expect(index.files["alias.md"]!.description).toBe("Inside heading");
  });

  test("relative apply_patch path resolves against session cwd, not project root", () => {
    const root = makeCrankProject({ "sub/dir/a.ts": "const a = 1;" });
    seedIndex(root);
    fs.writeFileSync(
      path.join(root, "sub/dir/fresh.ts"),
      "/** Fresh in subdir. */\nexport const f = 1;\n",
    );
    const payload = {
      ...(codexApplyPatch(
        root,
        "*** Begin Patch\n*** Add File: fresh.ts\n+x\n*** End Patch",
      ) as object),
      cwd: path.join(root, "sub/dir"),
    };
    const run = runHook(HOOK, JSON.stringify(payload));
    expect(run.status).toBe(0);
    expect(loadIndex(path.join(root, ".crank")).files["sub/dir/fresh.ts"]!.description).toBe(
      "Fresh in subdir.",
    );
  });

  test("overwriting an indexed file past the size cap drops its entry", () => {
    const root = makeCrankProject({ "a.ts": "const a = 1;", "grows.ts": "const g = 1;" });
    seedIndex(root);
    const crankDir = path.join(root, ".crank");
    const before = loadIndex(crankDir);
    expect(before.files["grows.ts"]).toBeDefined();

    fs.writeFileSync(path.join(root, "grows.ts"), "x".repeat(1024 * 1024 + 1));
    const run = runHook(HOOK, JSON.stringify(claudePostWrite(root, path.join(root, "grows.ts"))));
    expect(run.status).toBe(0);
    const after = loadIndex(crankDir);
    expect(after.files["grows.ts"]).toBeUndefined();
    expect(after.meta.fileCount).toBe(before.meta.fileCount - 1);

    // A new file past the cap is never indexed.
    fs.writeFileSync(path.join(root, "huge.ts"), "x".repeat(1024 * 1024 + 1));
    runHook(HOOK, JSON.stringify(claudePostWrite(root, path.join(root, "huge.ts"))));
    expect(loadIndex(crankDir).files["huge.ts"]).toBeUndefined();
  });

  test("binary content under an unlisted extension is skipped", () => {
    const root = makeCrankProject({ "a.ts": "const a = 1;" });
    seedIndex(root);
    fs.writeFileSync(path.join(root, "model.weights"), Buffer.from([0x93, 0x4e, 0x55, 0x00, 0x01]));
    const run = runHook(
      HOOK,
      JSON.stringify(claudePostWrite(root, path.join(root, "model.weights"))),
    );
    expect(run.status).toBe(0);
    expect(loadIndex(path.join(root, ".crank")).files["model.weights"]).toBeUndefined();
  });

  test("garbage stdin: exit 0", () => {
    expect(runHook(HOOK, "]]garbage").status).toBe(0);
  });

  test("empty stdin: exit 0", () => {
    expect(runHook(HOOK, "").status).toBe(0);
  });
});
