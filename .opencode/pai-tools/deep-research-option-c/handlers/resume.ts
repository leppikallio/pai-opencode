import { manifest_write } from "../../../tools/deep_research.ts";
import { resolveDeepResearchFlagsV1 } from "../../../tools/deep_research/lifecycle_lib";
import { emitJson } from "../cli/json-mode";
import {
  writeCheckpoint,
} from "../lib/fs-utils";
import { readJsonObject } from "../lib/io-json";
import {
  resolveLogsDirFromManifest,
  resolveRunHandle,
  summarizeManifest,
  withRunLock,
} from "../lib/run-handle";
import { nowIso } from "../lib/time";
import {
  callTool,
  type ToolWithExecute,
} from "../runtime/tool-envelope";

export type ResumeCliArgs = {
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

export async function runResume(args: ResumeCliArgs): Promise<void> {
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
    reason: `operator-cli resume: ${args.reason}`,
    fn: async () => {
      await callTool("manifest_write", manifest_write as unknown as ToolWithExecute, {
        manifest_path: runHandle.manifestPath,
        patch: { status: "running", stage: { started_at: nowIso() } },
        expected_revision: manifestRevision,
        reason: `operator-cli resume: ${args.reason}`,
      });

      checkpointPath = await writeCheckpoint({
        logsDirAbs,
        filename: "resume-checkpoint.md",
        content: [
          "# Resume Checkpoint",
          "",
          `- ts: ${nowIso()}`,
          `- run_id: ${summary.runId}`,
          `- stage: ${summary.stageCurrent}`,
          `- reason: ${args.reason}`,
        ].join("\n"),
      });

      if (!args.json) {
        console.log("resume.ok: true");
        console.log(`resume.checkpoint_path: ${checkpointPath}`);
      }
    },
  });

  if (args.json) {
    const currentSummary = await summarizeManifest(await readJsonObject(runHandle.manifestPath));
    emitJson({
      ok: true,
      command: "resume",
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
