import { emitJsonV1 } from "../cli/json-contract";
import { readJsonObject } from "../utils/io-json";
import { resolveDeepResearchCliInvocation } from "../utils/cli-invocation";
import {
  printContract,
  readGateStatusesSummary,
  resolveRunHandle,
  summarizeManifest,
} from "../utils/run-handle";
import {
  blockersSummaryJson,
  stageAdvanceDryRun,
  triageFromStageAdvanceResult,
} from "../triage/blockers";

export type RunTriageCliArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  json: boolean;
};

export async function runTriage(args: RunTriageCliArgs): Promise<void> {
  const runHandle = await resolveRunHandle(args);
  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const gateStatusesSummary = await readGateStatusesSummary(summary.gatesPath);

  const dryRun = await stageAdvanceDryRun({
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    reason: "operator-cli triage: stage-advance dry-run",
  });
  const triage = triageFromStageAdvanceResult(dryRun);
  const blockersSummary = blockersSummaryJson(triage);

  if (args.json) {
    const payload: Parameters<typeof emitJsonV1>[0] & Record<string, unknown> = {
      ok: true,
      command: "triage",
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
        blockers_summary: blockersSummary,
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
      blockers_summary: blockersSummary,
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

  console.log("triage:");
  console.log(`  allowed: ${triage.allowed}`);
  console.log(`  from: ${triage.from}`);
  console.log(`  to: ${triage.to}`);
  if (triage.errorCode) console.log(`  error.code: ${triage.errorCode}`);
  if (triage.errorMessage) console.log(`  error.message: ${triage.errorMessage}`);

  if (triage.missingArtifacts.length === 0 && triage.blockedGates.length === 0 && triage.failedChecks.length === 0) {
    console.log("  missing_artifacts: none");
    console.log("  blocked_gates: none");
    console.log("  failed_checks: none");
    return;
  }

  console.log("  missing_artifacts:");
  if (triage.missingArtifacts.length === 0) {
    console.log("    - none");
  } else {
    for (const item of triage.missingArtifacts) {
      console.log(`    - ${item.name}${item.path ? ` (${item.path})` : ""}`);
    }
  }

  console.log("  blocked_gates:");
  if (triage.blockedGates.length === 0) {
    console.log("    - none");
  } else {
    for (const gate of triage.blockedGates) {
      console.log(`    - ${gate.gate} (status=${gate.status ?? "unknown"})`);
    }
  }

  console.log("  failed_checks:");
  if (triage.failedChecks.length === 0) {
    console.log("    - none");
  } else {
    for (const check of triage.failedChecks) {
      console.log(`    - ${check.kind}: ${check.name}`);
    }
  }
}
