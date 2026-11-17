import * as path from "node:path";
import type { CrankConfig } from "../../hooks/lib/config.ts";
import {
  addAllowRule,
  COMMAND_PATHS,
  guardedCommand,
  hasCrankHooks,
  isCrankHookCommand,
  mergeHooksIntoFile,
  removeAllowRule,
  removeCrankHooksFromFile,
  type HookHandler,
  type HooksMap,
} from "../settings.ts";
import {
  attemptRemoval,
  attemptRepair,
  backupWith,
  checkParseable,
  claudeSettingsFiles,
  deleteNowEmpty,
  installPaths,
  isEmptyJson,
  pushLine,
  report,
  type InstallItem,
  type Report,
} from "../install-support.ts";
import type { AgentAdapter } from "../agents.ts";
import { distill } from "../../daemon/transcript.ts";

// The Claude Code adapter (ADR 0016): its hook map, command paths and the
// wiring of .claude/settings(.local).json, and its transcript reader.

/**
 * The subagent types that get the SubagentStart excerpt. The anchored list
 * leaves out custom and plugin agents; ADR 0007 records the census behind it.
 */
export const SUBAGENT_MATCHER = "^(general-purpose|Explore|Plan|workflow-subagent)$";

// Claude expands $CLAUDE_PROJECT_DIR.
const commandPath = COMMAND_PATHS.claude;

function hooks(runtime: CrankConfig["runtime"]): HooksMap {
  const entry = (script: string): HookHandler => ({
    type: "command",
    command: guardedCommand(runtime, commandPath(script)),
    timeout: 10,
  });
  return {
    SessionStart: [{ hooks: [entry("session-start.ts")] }],
    PostToolUse: [
      { matcher: "Write|Edit|MultiEdit", hooks: [entry("post-write.ts")] },
      // After the write group, so PostToolUse[0] stays the write matcher.
      { matcher: "Read|Bash", hooks: [entry("post-read.ts")] },
    ],
    Stop: [{ hooks: [entry("stop.ts")] }],
    SessionEnd: [{ hooks: [entry("session-end.ts")] }],
    SubagentStart: [{ matcher: SUBAGENT_MATCHER, hooks: [entry("subagent-start.ts")] }],
  };
}

// Crank hooks left in the Claude settings file the git mode does not use run
// every event twice.
function removeDuplicateClaudeHooks(
  r: Report,
  root: string,
  other: string,
  backup: (file: string) => void,
): void {
  if (!hasCrankHooks(other)) return;
  removeCrankHooksFromFile(other, isCrankHookCommand, backup);
  r.lines.push(`  removed duplicate crank hooks from ${path.relative(root, other)}`);
}

/**
 * True when init recorded `--agents codex`: Claude Code is left unwired, and repair keeps it that
 * way. Stored as `"claude": "skip"` in config.json (aegis/safety-fixes; see ATTRIBUTION.md).
 */
export function claudeSkipped(config: object): boolean {
  return (config as Record<string, unknown>).claude === "skip";
}

const claudeWiring: InstallItem = {
  apply(ctx) {
    const { root, config } = ctx;
    const backup = backupWith(ctx);
    const r = report();
    if (claudeSkipped(config)) {
      r.lines.push("  Claude Code: not wired (--agents codex)");
      return r;
    }
    const { wired, other } = claudeSettingsFiles(root, config.git);
    mergeHooksIntoFile(wired, claudeAdapter.hooks(config.runtime), backup);
    addAllowRule(wired, backup);
    r.lines.push(`  Claude Code: hooks wired into ${path.relative(root, wired)}`);
    removeDuplicateClaudeHooks(r, root, other, backup);
    return r;
  },
  repair(ctx) {
    const { root, config } = ctx;
    const backup = backupWith(ctx);
    const r = report();
    if (claudeSkipped(config)) return r;
    attemptRepair(r, "re-wire Claude Code hooks", () => {
      const { wired, other } = claudeSettingsFiles(root, config.git);
      removeDuplicateClaudeHooks(r, root, other, backup);
      if (mergeHooksIntoFile(wired, claudeAdapter.hooks(config.runtime), backup))
        r.lines.push(`  re-wired Claude Code hooks in ${path.relative(root, wired)}`);
      if (addAllowRule(wired, backup))
        r.lines.push("  added the crank-mem rules to permissions.allow");
    });
    return r;
  },
  remove({ root, crankDir }) {
    const { claudeShared, claudeLocal } = installPaths(root);
    const r = report();
    for (const f of [claudeShared, claudeLocal]) {
      attemptRemoval(r, root, f, () => {
        const rel = path.relative(root, f);
        let wrote = false;
        if (removeCrankHooksFromFile(f)) {
          r.lines.push(`  removed crank hooks from ${rel}`);
          wrote = true;
        }
        if (removeAllowRule(f)) {
          r.lines.push(`  removed the crank-mem allow rules from ${rel}`);
          wrote = true;
        }
        pushLine(r.lines, deleteNowEmpty(root, crankDir, f, isEmptyJson));
        if (!wrote) checkParseable(r, root, f);
      });
    }
    return r;
  },
};

export const claudeAdapter: AgentAdapter = {
  name: "claude",
  label: "Claude Code",
  hooks,
  commandPath,
  enabled: (config) => !claudeSkipped(config),
  wiring: claudeWiring,
  readTranscript: distill,
};
