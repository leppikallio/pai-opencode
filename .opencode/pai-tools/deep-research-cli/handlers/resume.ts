import { manifest_write } from "../../../tools/deep_research_cli.ts";
import { resolveDeepResearchCliFlagsV1 } from "../../../tools/deep_research_cli/lifecycle_lib";
import { emitJsonV1 } from "../cli/json-contract";
import { resolveDeepResearchCliInvocation } from "../utils/cli-invocation";
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

export type ResumeCliArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  reason: string;
  json?: boolean;
};

function ensureOptionCEnabledForCli(): void {
  const flags = resolveDeepResearchCliFlagsV1();
  if (!flags.cliEnabled) {
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
    emitJsonV1({
      ok: true,
      command: "resume",
      contract: {
        run_id: currentSummary.runId,
        run_root: currentSummary.runRoot,
        manifest_path: runHandle.manifestPath,
        gates_path: currentSummary.gatesPath,
        stage_current: currentSummary.stageCurrent,
        status: currentSummary.status,
        cli_invocation: resolveDeepResearchCliInvocation(),
      },
      result: {
        checkpoint_path: checkpointPath,
      },
      error: null,
      halt: null,
    });
  }
}
