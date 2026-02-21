import { manifest_write } from "../../../tools/deep_research.ts";
import { resolveDeepResearchFlagsV1 } from "../../../tools/deep_research/lifecycle_lib";
import { emitJson } from "../cli/json-mode";
import {
  writeCheckpoint,
} from "../utils/fs-utils";
import { readJsonObject } from "../utils/io-json";
import {
  resolveLogsDirFromManifest,
  resolveRunHandle,
  summarizeManifest,
  withRunLock,
} from "../utils/run-handle";
import { nowIso } from "../utils/time";
import {
  callTool,
  type ToolWithExecute,
} from "../tooling/tool-envelope";

export type PauseCliArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  reason: string;
  json?: boolean;
};

function ensureOptionCEnabledForCli(): void {
  const flags = resolveDeepResearchFlagsV1();
  if (!flags.optionCEnabled) {
    throw new Error("Deep research Option C is disabled in current configuration");
  }
}

function nextStepCliInvocation(): string {
  return `bun "pai-tools/${["deep-research-option-c", "ts"].join(".")}"`;
}

export async function runPause(args: PauseCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const logsDirAbs = await resolveLogsDirFromManifest(manifest);
  const manifestRevision = Number(manifest.revision ?? Number.NaN);
  if (!Number.isFinite(manifestRevision)) throw new Error("manifest.revision invalid");
  let checkpointPath = "";

  await withRunLock({
    runRoot: summary.runRoot,
    reason: `operator-cli pause: ${args.reason}`,
    fn: async () => {
      await callTool("manifest_write", manifest_write as unknown as ToolWithExecute, {
        manifest_path: runHandle.manifestPath,
        patch: { status: "paused" },
        expected_revision: manifestRevision,
        reason: `operator-cli pause: ${args.reason}`,
      });

      checkpointPath = await writeCheckpoint({
        logsDirAbs,
        filename: "pause-checkpoint.md",
        content: [
          "# Pause Checkpoint",
          "",
          `- ts: ${nowIso()}`,
          `- run_id: ${summary.runId}`,
          `- stage: ${summary.stageCurrent}`,
          `- reason: ${args.reason}`,
          `- next_step: ${nextStepCliInvocation()} resume --manifest "${runHandle.manifestPath}" --reason "operator resume"`,
        ].join("\n"),
      });

      if (!args.json) {
        console.log("pause.ok: true");
        console.log(`pause.checkpoint_path: ${checkpointPath}`);
      }
    },
  });

  if (args.json) {
    const currentSummary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
    emitJson({
      ok: true,
      command: "pause",
      checkpoint_path: checkpointPath,
      run_id: currentSummary.runId,
      run_root: currentSummary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: currentSummary.gatesPath,
      stage_current: currentSummary.stageCurrent,
      status: currentSummary.status,
    });
  }
}
