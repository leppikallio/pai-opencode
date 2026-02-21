import * as fs from "node:fs/promises";
import * as path from "node:path";

import { resolveDeepResearchFlagsV1 } from "../../../tools/deep_research/lifecycle_lib";
import { readJsonObject } from "../utils/io-json";
import {
  requireAbsolutePath,
  safeResolveManifestPath,
} from "../utils/paths";
import {
  printContract,
  summarizeManifest,
  withRunLock,
} from "../utils/run-handle";
import { nowIso } from "../utils/time";

export type RerunWave1CliArgs = {
  manifest: string;
  perspective: string;
  reason: string;
};

function ensureOptionCEnabledForCli(): void {
  const flags = resolveDeepResearchFlagsV1();
  if (!flags.optionCEnabled) {
    throw new Error("Deep research Option C is disabled in current configuration");
  }
}

export async function runRerunWave1(args: RerunWave1CliArgs): Promise<void> {
  ensureOptionCEnabledForCli();

  const manifestPath = requireAbsolutePath(args.manifest, "--manifest");
  const perspective = args.perspective.trim();
  const reason = args.reason.trim();

  if (!/^[A-Za-z0-9_-]+$/.test(perspective)) {
    throw new Error("--perspective must contain only letters, numbers, underscores, or dashes");
  }
  if (!reason) {
    throw new Error("--reason must be non-empty");
  }

  const manifest = await readJsonObject(manifestPath);
  const summary = await summarizeManifest(manifest);
  const retryDirectivesPath = await safeResolveManifestPath(
    summary.runRoot,
    "retry/retry-directives.json",
    "retry.retry_directives_file",
  );

  const retryArtifact = {
    schema_version: "wave1.retry_directives.v1",
    run_id: summary.runId,
    stage: "wave1",
    generated_at: nowIso(),
    consumed_at: null,
    retry_directives: [
      {
        perspective_id: perspective,
        action: "retry",
        change_note: reason,
      },
    ],
    deferred_validation_failures: [],
  };

  await withRunLock({
    runRoot: summary.runRoot,
    reason: `operator-cli rerun wave1: ${reason}`,
    fn: async () => {
      await fs.mkdir(path.dirname(retryDirectivesPath), { recursive: true });
      await fs.writeFile(retryDirectivesPath, `${JSON.stringify(retryArtifact, null, 2)}\n`, "utf8");
    },
  });

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log("rerun.wave1.ok: true");
  console.log(`rerun.wave1.retry_directives_path: ${retryDirectivesPath}`);
  console.log(`rerun.wave1.perspective_id: ${perspective}`);
}
