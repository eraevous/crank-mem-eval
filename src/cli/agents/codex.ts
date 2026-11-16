import * as path from "node:path";
import type { CrankConfig } from "../../hooks/lib/config.ts";
import {
  ensureCodexFeatures,
  guardedCommand,
  mergeHooksIntoFile,
  removeCodexFeatures,
  removeCrankHooksFromFile,
  type HookHandler,
  type HooksMap,
} from "../settings.ts";
import {
  CODEX_REVIEW_HINT,
  codexTrustStatus,
  crankTrust,
  removeTrustEntries,
  userCodexConfigPath,
  writeTrustEntries,
} from "../codex-trust.ts";
import {
  attemptRemoval,
  attemptRepair,
  backupWith,
  checkParseable,
  deleteNowEmpty,
  installPaths,
  isBlank,
  isEmptyJson,
  pushLine,
  report,
  type InstallItem,
} from "../install-support.ts";
import type { AgentAdapter } from "../agents.ts";

// The Codex adapter (ADR 0016): its hook map, command paths, the wiring of
// .codex/hooks.json and .codex/config.toml, and the trusted_hash step (ADR 0002).

// Codex runs hooks with the project cwd.
const commandPath = (script: string): string => `.crank/hooks/${script}`;

// File history, Stop, SessionEnd and SubagentStart are Claude-only; Codex has no digests.
function hooks(runtime: CrankConfig["runtime"]): HooksMap {
  const entry = (script: string): HookHandler => ({
    type: "command",
    command: guardedCommand(runtime, commandPath(script)),
    timeout: 10,
  });
  return {
    SessionStart: [{ hooks: [entry("session-start.ts")] }],
    PostToolUse: [{ matcher: "apply_patch", hooks: [entry("post-write.ts")] }],
  };
}

/**
 * Writes trust for crank's generated hook commands only. A command that is not
 * a generated form (a repository edited it, say) loses any entry it had, so
 * Codex asks for a review before running it; returns the report lines saying so.
 */
function writeCrankTrust(codexHooks: string, backup: (file: string) => void): string[] {
  const t = crankTrust(codexHooks);
  writeTrustEntries(userCodexConfigPath(), t.entries, [...t.staleKeys, ...t.untrustedKeys], backup);
  if (t.untrustedKeys.length === 0) return [];
  return [
    `  Codex trust: ${t.untrustedKeys.length} edited crank hook command(s) in ${path.basename(path.dirname(codexHooks))}/${path.basename(codexHooks)} left untrusted`,
    ...CODEX_REVIEW_HINT,
  ];
}

/** Trust keys come from hooks.json as it stands; returns whether any were removed. */
function removeCrankTrust(codexHooks: string): boolean {
  const keys = crankTrust(codexHooks).keys;
  if (keys.length === 0) return false;
  removeTrustEntries(userCodexConfigPath(), keys);
  return true;
}

/** The trusted_hash step; only `codexWiring` below calls it (ADR 0016, trust lifecycle). */
const codexTrust: NonNullable<AgentAdapter["trust"]> = {
  status: (root) => {
    const { codexHooks } = installPaths(root);
    return codexTrustStatus(userCodexConfigPath(), root, codexHooks);
  },
  write: (root, backup) => writeCrankTrust(installPaths(root).codexHooks, backup),
  remove: (root) =>
    removeCrankTrust(installPaths(root).codexHooks)
      ? [`  removed trusted_hash entries from ${userCodexConfigPath()}`]
      : [],
};

const codexWiring: InstallItem = {
  apply(ctx) {
    const { root, config } = ctx;
    if (config.codex === "skip") return report(["  Codex: skipped"]);
    const backup = backupWith(ctx);
    const { codexHooks, codexConfig } = installPaths(root);
    mergeHooksIntoFile(codexHooks, codexAdapter.hooks(config.runtime), backup);
    ensureCodexFeatures(codexConfig, backup);
    const r = report(["  Codex: hooks wired into .codex/hooks.json"]);
    if (config.codex === "trust") {
      const untrusted = codexTrust.write(root, backup);
      r.lines.push(`  Codex trust: trusted_hash entries written to ${userCodexConfigPath()}`);
      r.lines.push(...untrusted);
    } else {
      r.lines.push(...CODEX_REVIEW_HINT);
    }
    return r;
  },
  // A skip install leaves .codex/ alone. Trust is rewritten only when an entry
  // is missing or stale or an older release's PascalCase orphan is present, so
  // an install already trusted keeps its config.toml untouched.
  repair(ctx) {
    const { root, config } = ctx;
    const r = report();
    if (config.codex === "skip") return r;
    const backup = backupWith(ctx);
    const { codexHooks, codexConfig } = installPaths(root);
    attemptRepair(r, "re-wire Codex hooks", () => {
      if (mergeHooksIntoFile(codexHooks, codexAdapter.hooks(config.runtime), backup)) {
        r.lines.push(`  re-wired Codex hooks in ${path.relative(root, codexHooks)}`);
        if (config.codex === "review") r.lines.push(...CODEX_REVIEW_HINT);
      }
      if (ensureCodexFeatures(codexConfig, backup))
        r.lines.push(
          `  added the crank-mem [features] snippet to ${path.relative(root, codexConfig)}`,
        );
      if (config.codex === "trust") {
        const s = codexTrust.status(root);
        if (s.missing + s.stale + s.orphans + s.untrusted > 0) {
          const untrusted = codexTrust.write(root, backup);
          r.lines.push("  recomputed Codex trusted_hash entries");
          r.lines.push(...untrusted);
        }
      }
    });
    return r;
  },
  remove({ root, crankDir, config }) {
    const { codexHooks, codexConfig } = installPaths(root);
    const r = report();
    // Trust keys come from hooks.json as it stands, before the hooks strip.
    // Both spellings go — older releases keyed on the raw PascalCase event.
    if (config.codex === "trust") {
      attemptRemoval(r, root, userCodexConfigPath(), () => {
        r.lines.push(...codexTrust.remove(root));
      });
    }
    attemptRemoval(r, root, codexHooks, () => {
      const wrote = removeCrankHooksFromFile(codexHooks);
      if (wrote) r.lines.push(`  removed crank hooks from ${path.relative(root, codexHooks)}`);
      pushLine(r.lines, deleteNowEmpty(root, crankDir, codexHooks, isEmptyJson));
      if (!wrote) checkParseable(r, root, codexHooks);
    });
    attemptRemoval(r, root, codexConfig, () => {
      removeCodexFeatures(codexConfig);
      pushLine(r.lines, deleteNowEmpty(root, crankDir, codexConfig, isBlank));
    });
    return r;
  },
};

export const codexAdapter: AgentAdapter = {
  name: "codex",
  label: "Codex",
  hooks,
  commandPath,
  enabled: (config) => config.codex !== "skip",
  wiring: codexWiring,
  trust: codexTrust,
};
