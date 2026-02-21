import { emitContractCommandJson } from "../cli/contract-json";
import { readJsonObject } from "../utils/io-json";
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
    emitContractCommandJson({
      command: "status",
      summary,
      manifestPath: runHandle.manifestPath,
      gateStatusesSummary,
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
}
