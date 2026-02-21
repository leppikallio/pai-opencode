import { stage_advance } from "../../../tools/deep_research_cli.ts";
import { resolveDeepResearchFlagsV1 } from "../../../tools/deep_research_cli/lifecycle_lib";
import { emitJson } from "../cli/json-mode";
import {
  asObject,
  readJsonObject,
} from "../utils/io-json";
import {
  printContract,
  resolveRunHandle,
  summarizeManifest,
} from "../utils/run-handle";
import {
  callTool,
  type ToolWithExecute,
} from "../tooling/tool-envelope";

export type RunStageAdvanceArgs = {
  manifest: string;
  gates?: string;
  requestedNext?: string;
  reason: string;
  json: boolean;
};

function ensureOptionCEnabledForCli(): void {
  const flags = resolveDeepResearchFlagsV1();
  if (!flags.optionCEnabled) {
    throw new Error("Deep research Option C is disabled in current configuration");
  }
}

export async function runStageAdvance(args: RunStageAdvanceArgs): Promise<void> {
  ensureOptionCEnabledForCli();

  const runHandle = await resolveRunHandle({
    manifest: args.manifest,
    gates: args.gates,
  });

  const stageAdvance = await callTool("stage_advance", stage_advance as unknown as ToolWithExecute, {
    manifest_path: runHandle.manifestPath,
    gates_path: runHandle.gatesPath,
    ...(args.requestedNext ? { requested_next: args.requestedNext } : {}),
    reason: args.reason,
  });

  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);

  if (args.json) {
    emitJson({
      ok: true,
      command: "stage-advance",
      run_id: summary.runId,
      run_root: summary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      from: String(stageAdvance.from ?? ""),
      to: String(stageAdvance.to ?? ""),
      manifest_revision: Number(stageAdvance.manifest_revision ?? Number.NaN),
      decision_inputs_digest: String((asObject(stageAdvance.decision).inputs_digest ?? "")),
    });
    return;
  }

  printContract({
    runId: summary.runId,
    runRoot: summary.runRoot,
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    stageCurrent: summary.stageCurrent,
    status: summary.status,
  });
  console.log("stage_advance.ok: true");
  console.log(`stage_advance.from: ${String(stageAdvance.from ?? "")}`);
  console.log(`stage_advance.to: ${String(stageAdvance.to ?? "")}`);
  console.log(`stage_advance.manifest_revision: ${String(stageAdvance.manifest_revision ?? "")}`);
}
