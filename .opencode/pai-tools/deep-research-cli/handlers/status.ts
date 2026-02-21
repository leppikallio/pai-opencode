import { emitJsonV1 } from "../cli/json-contract";
import { readJsonObject } from "../utils/io-json";
import { resolveDeepResearchCliInvocation } from "../utils/cli-invocation";
import {
  printContract,
  readGateStatusesSummary,
  resolveRunHandle,
  summarizeManifest,
} from "../utils/run-handle";

export type RunStatusCliArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  json: boolean;
};

export async function runStatus(args: RunStatusCliArgs): Promise<void> {
  const runHandle = await resolveRunHandle(args);
  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);

  if (args.json) {
    const gateStatusesSummary = await readGateStatusesSummary(summary.gatesPath);
    const payload: Parameters<typeof emitJsonV1>[0] & Record<string, unknown> = {
      ok: true,
      command: "status",
      contract: {
        run_id: summary.runId,
        run_root: summary.runRoot,
        manifest_path: runHandle.manifestPath,
        gates_path: summary.gatesPath,
        stage_current: summary.stageCurrent,
        status: summary.status,
        cli_invocation: resolveDeepResearchCliInvocation(),
      },
      result: {
        gate_statuses_summary: gateStatusesSummary,
      },
      error: null,
      halt: null,
      // Legacy transitional mirrors (consumed by existing entity tests).
      run_id: summary.runId,
      run_root: summary.runRoot,
      manifest_path: runHandle.manifestPath,
      gates_path: summary.gatesPath,
      stage_current: summary.stageCurrent,
      status: summary.status,
      gate_statuses_summary: gateStatusesSummary,
    };
    emitJsonV1(payload);
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
}
