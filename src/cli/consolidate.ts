import { saveConfig } from "../hooks/lib/config.ts";
import { COMMANDS } from "./commands.ts";
import { openNearestProject } from "./project.ts";

// `crank-mem consolidate on|off` (aegis/safety-fixes; see ATTRIBUTION.md).
//
// Consolidation used to follow every digest. It is now off until turned on here, per checkout:
// the switch lives in .crank/config.local.json beside `digest`, so a committed config.json
// cannot turn it on for everyone. It does nothing while digests are off.

export async function run(args: string[]): Promise<number> {
  const sub = args[0];
  if (sub !== "on" && sub !== "off") {
    console.error(COMMANDS.consolidate.usage);
    return 1;
  }
  const project = openNearestProject();
  if (!project) return 1;
  saveConfig(project.crankDir, { ...project.config, consolidate: sub === "on" });
  if (sub === "off") {
    console.log("crank-mem: consolidation off. Proposals wait, pending, in the store.");
    return 0;
  }
  console.log(
    "crank-mem: consolidation on. After each digest, a `claude -p` run with no tools checks pending proposals against excerpts of the files they cite, and edits cerebrum.md.",
  );
  if (!project.config.digest)
    console.error(
      "crank-mem: note: digests are off, so nothing consolidates until `crank-mem digest on`.",
    );
  return 0;
}
