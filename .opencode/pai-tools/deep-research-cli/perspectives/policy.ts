import * as fs from "node:fs/promises";
import * as path from "node:path";

import { sha256HexLowerUtf8 } from "../../../tools/deep_research_cli/lifecycle_lib";

import type { PerspectivesPolicyArtifactV1 } from "./state";

function stableDigest(value: Record<string, unknown>): string {
  return `sha256:${sha256HexLowerUtf8(JSON.stringify(value))}`;
}

async function writeJsonFileIfChanged(filePath: string, payload: Record<string, unknown>): Promise<boolean> {
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    const existing = await fs.readFile(filePath, "utf8");
    if (existing === serialized) return false;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "ENOENT") throw error;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serialized, "utf8");
  return true;
}

export function buildDefaultPerspectivesPolicyArtifact(): PerspectivesPolicyArtifactV1 {
  return {
    schema_version: "perspectives-policy.v1",
    thresholds: {
      ensemble_threshold: 80,
      backup_threshold: 85,
      match_bonus: 10,
      mismatch_penalty: -25,
      threshold_operator: ">=",
      confidence: {
        type: "integer",
        min: 0,
        max: 100,
      },
    },
    track_allocation: {
      standard: 0.5,
      independent: 0.25,
      contrarian: 0.25,
      rounding: "largest_remainder_method",
    },
    partial_failure_policy: {
      mode: "fail_closed",
      on_partial_failure: "awaiting_agent_results",
    },
  };
}

export async function writeDefaultPerspectivesPolicy(args: {
  runRoot: string;
}): Promise<{ policyPath: string; policyDigest: string; changed: boolean }> {
  const policyPath = path.join(args.runRoot, "operator", "config", "perspectives-policy.json");
  const policyArtifact = buildDefaultPerspectivesPolicyArtifact();
  const changed = await writeJsonFileIfChanged(policyPath, policyArtifact);
  return {
    policyPath,
    policyDigest: stableDigest(policyArtifact),
    changed,
  };
}
