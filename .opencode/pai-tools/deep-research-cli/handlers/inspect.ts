import { emitJsonV1 } from "../cli/json-contract";
import {
  asObject,
  readJsonObject,
} from "../utils/io-json";
import { resolveDeepResearchCliInvocation } from "../utils/cli-invocation";
import { safeResolveManifestPath } from "../utils/paths";
import {
  gateStatusesSummaryRecord,
  parseGateStatuses,
  printContract,
  resolveRunHandle,
  summarizeManifest,
} from "../utils/run-handle";
import { resolveLatestOnlineFixtures } from "../triage/halt-artifacts";
import {
  blockersSummaryJson,
  readBlockedUrlsInspectSummary,
  stageAdvanceDryRun,
  triageFromStageAdvanceResult,
} from "../triage/blockers";

export type RunInspectCliArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  json: boolean;
};

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return await readJsonObject(filePath);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

async function printInspectOperatorGuidance(runRoot: string): Promise<void> {
  const blockedUrlsPath = await safeResolveManifestPath(runRoot, "citations/blocked-urls.json", "citations.blocked_urls");
  const retryDirectivesPath = await safeResolveManifestPath(runRoot, "retry/retry-directives.json", "retry.retry_directives");

  const blockedUrls = await readJsonIfExists(blockedUrlsPath);
  const retryDirectives = await readJsonIfExists(retryDirectivesPath);
  const latestOnlineFixturesPath = await resolveLatestOnlineFixtures(runRoot);

  if (blockedUrls) {
    const items = Array.isArray(blockedUrls.items) ? blockedUrls.items : [];
    console.log("citations.blocked_urls:");
    console.log(`  path: ${blockedUrlsPath}`);
    console.log(`  count: ${items.length}`);
    for (const raw of items.slice(0, 5)) {
      const item = asObject(raw);
      console.log(`  - ${String(item.url ?? item.normalized_url ?? "unknown")}`);
      console.log(`    action: ${String(item.action ?? "review citation access path")}`);
    }
    if (items.length > 0) {
      console.log("  next: replace blocked URLs or add acceptable sources, then re-run citations stage");
    }
  }

  if (retryDirectives) {
    const directives = Array.isArray(retryDirectives.retry_directives) ? retryDirectives.retry_directives : [];
    const consumedAt = String(retryDirectives.consumed_at ?? "").trim();
    console.log("retry.directives:");
    console.log(`  path: ${retryDirectivesPath}`);
    console.log(`  count: ${directives.length}`);
    if (consumedAt) {
      console.log(`  consumed_at: ${consumedAt}`);
    } else if (directives.length > 0) {
      console.log("  next: apply retry directives and run tick again");
    }
  }

  if (latestOnlineFixturesPath) {
    console.log("citations.online_fixtures_latest:");
    console.log(`  path: ${latestOnlineFixturesPath}`);
    console.log("  next: use this fixture for deterministic replay/debug");
  }
}

export async function runInspect(args: RunInspectCliArgs): Promise<void> {
  const runHandle = await resolveRunHandle(args);
  const manifest = await readJsonObject(runHandle.manifestPath);
  const summary = await summarizeManifest(manifest);
  const gatesDoc = await readJsonObject(summary.gatesPath);
  const gateStatuses = parseGateStatuses(gatesDoc);
  const blockedUrlsSummary = await readBlockedUrlsInspectSummary(summary.runRoot);
  const dryRun = await stageAdvanceDryRun({
    manifestPath: runHandle.manifestPath,
    gatesPath: summary.gatesPath,
    reason: "operator-cli inspect: stage-advance dry-run",
  });
  const triage = triageFromStageAdvanceResult(dryRun);
  const blockersSummary = blockersSummaryJson(triage);

  if (args.json) {
    const gateStatusesSummary = gateStatusesSummaryRecord(gateStatuses);
    const payload: Parameters<typeof emitJsonV1>[0] & Record<string, unknown> = {
      ok: true,
      command: "inspect",
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

  console.log("gate_statuses:");
  for (const gate of gateStatuses) {
    console.log(`  - ${gate.id}: ${gate.status}${gate.checked_at ? ` @ ${gate.checked_at}` : ""}`);
  }

  if (blockedUrlsSummary) {
    console.log("citations_blockers:");
    console.log(`  artifact_path: ${blockedUrlsSummary.artifactPath}`);
    console.log(`  total: ${blockedUrlsSummary.total}`);

    console.log("  by_status:");
    if (blockedUrlsSummary.byStatus.length === 0) {
      console.log("    - none");
    } else {
      for (const row of blockedUrlsSummary.byStatus) {
        console.log(`    - ${row.status}: ${row.count}`);
      }
    }

    console.log("  next_steps:");
    if (blockedUrlsSummary.topActions.length === 0) {
      console.log("    - none");
    } else {
      for (const row of blockedUrlsSummary.topActions) {
        console.log(`    - ${row.action} (count=${row.count})`);
      }
    }
  }

  console.log("blockers:");
  if (triage.allowed) {
    console.log(`  - none (next transition allowed: ${triage.from} -> ${triage.to})`);
  } else if (triage.missingArtifacts.length === 0 && triage.blockedGates.length === 0 && triage.failedChecks.length === 0) {
    console.log(`  - ${triage.errorCode ?? "UNKNOWN"}: ${triage.errorMessage ?? "Unknown blocker"}`);
  } else {
    for (const item of triage.missingArtifacts) {
      console.log(`  - missing artifact: ${item.name}${item.path ? ` (${item.path})` : ""}`);
    }
    for (const gate of triage.blockedGates) {
      console.log(`  - blocked gate: ${gate.gate} (status=${gate.status ?? "unknown"})`);
    }
    for (const check of triage.failedChecks) {
      console.log(`  - failed ${check.kind}: ${check.name}`);
    }
  }

  await printInspectOperatorGuidance(summary.runRoot);
}
