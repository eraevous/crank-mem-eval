import * as path from "node:path";
import {
  addAllowRule,
  crankHooks,
  ensureCodexFeatures,
  hasCrankHooks,
  isCrankHookCommand,
  mergeHooksIntoFile,
  removeAllowRule,
  removeCodexFeatures,
  removeCrankHooksFromFile,
} from "./settings.ts";
import {
  CODEX_REVIEW_HINT,
  codexTrustStatus,
  crankTrust,
  removeTrustEntries,
  userCodexConfigPath,
  writeTrustEntries,
} from "./codex-trust.ts";
import {
  attemptRemoval,
  attemptRepair,
  backupWith,
  checkParseable,
  claudeSettingsFiles,
  deleteNowEmpty,
  installPaths,
  isBlank,
  isEmptyJson,
  pushLine,
  report,
  type InstallContext,
  type InstallItem,
  type Report,
} from "./install-support.ts";

// The Claude Code and Codex wiring install items.

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

// Both init and upgrade drop duplicate hooks first, then merge the hooks and
// the allow rule into the file the git mode wires.
function ensureClaudeWiring(ctx: InstallContext, r: Report): { merged: boolean; allowed: boolean } {
  const { root, config } = ctx;
  const backup = backupWith(ctx);
  const { wired, other } = claudeSettingsFiles(root, config.git);
  removeDuplicateClaudeHooks(r, root, other, backup);
  const merged = mergeHooksIntoFile(wired, crankHooks(config.runtime, "claude"), backup);
  const allowed = addAllowRule(wired, backup);
  return { merged, allowed };
}

export const claudeWiring: InstallItem = {
  apply(ctx) {
    const r = report();
    const { wired } = claudeSettingsFiles(ctx.root, ctx.config.git);
    r.lines.push(`  Claude Code: hooks wired into ${path.relative(ctx.root, wired)}`);
    ensureClaudeWiring(ctx, r);
    return r;
  },
  repair(ctx) {
    const r = report();
    attemptRepair(r, "re-wire Claude Code hooks", () => {
      const { wired } = claudeSettingsFiles(ctx.root, ctx.config.git);
      const { merged, allowed } = ensureClaudeWiring(ctx, r);
      if (merged) r.lines.push(`  re-wired Claude Code hooks in ${path.relative(ctx.root, wired)}`);
      if (allowed) r.lines.push("  added the crank-mem rules to permissions.allow");
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

// Trust is rewritten only when an entry is missing or outdated, an older
// release's PascalCase orphan is present, or an edited command still has a
// trust table, so an install already trusted keeps its config.toml untouched.
// Trust goes only to crank's generated hook commands: a command a repository
// edited (appended shell, say) loses any entry it had, so Codex asks for a
// review before running it. Callers skip this for a skip install.
function ensureCodexWiring(ctx: InstallContext): {
  merged: boolean;
  featured: boolean;
  trusted: boolean;
  /** Report lines naming the edited crank hook commands left untrusted; empty when none. */
  untrusted: string[];
} {
  const { root, config } = ctx;
  const backup = backupWith(ctx);
  const { codexHooks, codexConfig } = installPaths(root);
  const merged = mergeHooksIntoFile(codexHooks, crankHooks(config.runtime, "codex"), backup);
  const featured = ensureCodexFeatures(codexConfig, backup);
  let trusted = false;
  let untrusted: string[] = [];
  if (config.codex === "trust") {
    const t = crankTrust(codexHooks);
    const s = codexTrustStatus(userCodexConfigPath(), root, codexHooks);
    if (s.missing + s.stale + s.orphans + s.untrusted > 0) {
      writeTrustEntries(
        userCodexConfigPath(),
        t.entries,
        [...t.staleKeys, ...t.untrustedKeys],
        backup,
      );
      trusted = true;
    }
    if (t.untrustedKeys.length > 0)
      untrusted = [
        `  Codex trust: ${t.untrustedKeys.length} edited crank hook command(s) in ${path.basename(path.dirname(codexHooks))}/${path.basename(codexHooks)} left untrusted`,
        ...CODEX_REVIEW_HINT,
      ];
  }
  return { merged, featured, trusted, untrusted };
}

export const codexWiring: InstallItem = {
  apply(ctx) {
    const { config } = ctx;
    if (config.codex === "skip") return report(["  Codex: skipped"]);
    const { untrusted } = ensureCodexWiring(ctx);
    const r = report(["  Codex: hooks wired into .codex/hooks.json"]);
    if (config.codex === "trust") {
      r.lines.push(`  Codex trust: trusted_hash entries written to ${userCodexConfigPath()}`);
      r.lines.push(...untrusted);
    } else r.lines.push(...CODEX_REVIEW_HINT);
    return r;
  },
  // A skip install leaves .codex/ alone.
  repair(ctx) {
    const { root, config } = ctx;
    const r = report();
    if (config.codex === "skip") return r;
    const { codexHooks, codexConfig } = installPaths(root);
    attemptRepair(r, "re-wire Codex hooks", () => {
      const { merged, featured, trusted, untrusted } = ensureCodexWiring(ctx);
      if (merged) {
        r.lines.push(`  re-wired Codex hooks in ${path.relative(root, codexHooks)}`);
        if (config.codex === "review") r.lines.push(...CODEX_REVIEW_HINT);
      }
      if (featured)
        r.lines.push(
          `  added the crank-mem [features] snippet to ${path.relative(root, codexConfig)}`,
        );
      if (trusted) {
        r.lines.push("  recomputed Codex trusted_hash entries");
        r.lines.push(...untrusted);
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
        const keys = crankTrust(codexHooks).keys;
        if (keys.length > 0) {
          removeTrustEntries(userCodexConfigPath(), keys);
          r.lines.push(`  removed trusted_hash entries from ${userCodexConfigPath()}`);
        }
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
