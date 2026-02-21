import { manifest_write } from "../../../tools/deep_research_cli.ts";
import { resolveDeepResearchFlagsV1 } from "../../../tools/deep_research_cli/lifecycle_lib";
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

export type CancelCliArgs = {
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
  return `bun "pai-tools/${["deep-research-cli", "ts"].join(".")}"`;
}

export async function runCancel(args: CancelCliArgs): Promise<void> {
  ensureOptionCEnabledForCli();
  const runHandle = await resolveRunHandle(args);

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const logsDirAbs = await resolveLogsDirFromManifest(manifest);
  const manifestRevision = Number(manifest.revision ?? Number.NaN);
  if (!Number.isFinite(manifestRevision)) throw new Error("manifest.revision invalid");

  if (summary.status === "cancelled") {
    if (args.json) {
      emitJson({
        ok: true,
        command: "cancel",
        note: "already cancelled",
        run_id: summary.runId,
        run_root: summary.runRoot,
        manifest_path: runHandle.manifestPath,
        gates_path: summary.gatesPath,
        stage_current: summary.stageCurrent,
        status: summary.status,
      });
    } else {
      console.log("cancel.ok: true");
      console.log("cancel.note: already cancelled");
    }
    return;
  }

  let checkpointPath = "";

  await withRunLock({
    runRoot: summary.runRoot,
    reason: `operator-cli cancel: ${args.reason}`,
    fn: async () => {
      await callTool("manifest_write", manifest_write as unknown as ToolWithExecute, {
        manifest_path: runHandle.manifestPath,
        patch: { status: "cancelled" },
        expected_revision: manifestRevision,
        reason: `operator-cli cancel: ${args.reason}`,
      });

      checkpointPath = await writeCheckpoint({
        logsDirAbs,
        filename: "cancel-checkpoint.md",
        content: [
          "# Cancel Checkpoint",
          "",
          `- ts: ${nowIso()}`,
          `- run_id: ${summary.runId}`,
          `- stage: ${summary.stageCurrent}`,
          `- reason: ${args.reason}`,
          `- next_step: ${nextStepCliInvocation()} status --manifest "${runHandle.manifestPath}"`,
        ].join("\n"),
      });

      if (!args.json) {
        console.log("cancel.ok: true");
        console.log(`cancel.checkpoint_path: ${checkpointPath}`);
      }
    },
  });

  if (args.json) {
    const currentSummary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
    emitJson({
      ok: true,
      command: "cancel",
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
