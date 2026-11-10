import { spawnSync } from "node:child_process";
import type { CrankConfig } from "../hooks/lib/config.ts";

// Which runtime runs crank-mem's hooks: bun, else node >= 23.6 (both run .ts directly).
// Moved here from init.ts unchanged (aegis/safety-fixes) so `doctor` can share it.

export function detectRuntime(): CrankConfig["runtime"] | null {
  if (spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0) return "bun";
  const res = spawnSync("node", ["--version"], { encoding: "utf-8" });
  if (res.status === 0) {
    const m = res.stdout.trim().match(/^v(\d+)\.(\d+)/);
    if (m && (Number(m[1]) > 23 || (Number(m[1]) === 23 && Number(m[2]) >= 6))) return "node";
  }
  return null;
}
