import * as path from "node:path";

import {
  run_metrics_write,
  telemetry_append,
  tick_ledger_append,
} from "../../../tools/deep_research_cli.ts";
import { sha256HexLowerUtf8 } from "../../../tools/deep_research_cli/lifecycle_lib";
import { resultErrorDetails } from "../cli/errors";
import {
  readJsonObject,
  readJsonlRecords,
} from "../utils/io-json";
import {
  resolveLogsDirFromManifest,
  summarizeManifest,
} from "../utils/run-handle";
import {
  callTool,
  type ToolWithExecute,
} from "../tooling/tool-envelope";
import {
  computeTickOutcome,
  type TickResultLike,
} from "./tick-outcome";

const TICK_METRICS_INTERVAL = 1;

export type TickObservabilityContext = {
  manifestPath: string;
  gatesPath: string;
  runId: string;
  runRoot: string;
  logsDirAbs: string;
  telemetryPath: string;
  stageBefore: string;
  statusBefore: string;
  stageAttempt: number;
  tickIndex: number;
  stageStartedDigest: string;
  startedAtMs: number;
};

function stableDigest(value: Record<string, unknown>): string {
  return `sha256:${sha256HexLowerUtf8(JSON.stringify(value))}`;
}

function safePositiveInt(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

async function nextTickIndex(logsDirAbs: string): Promise<number> {
  const ledgerPath = path.join(logsDirAbs, "ticks.jsonl");
  const rows = await readJsonlRecords(ledgerPath);
  let maxTick = 0;
  for (const row of rows) {
    const value = safePositiveInt(row.tick_index, 0);
    if (value > maxTick) maxTick = value;
  }
  return maxTick + 1;
}

async function nextStageAttempt(telemetryPath: string, stageId: string): Promise<number> {
  const rows = await readJsonlRecords(telemetryPath);
  let count = 0;
  for (const row of rows) {
    if (String(row.event_type ?? "") !== "stage_started") continue;
    if (String(row.stage_id ?? "") !== stageId) continue;
    count += 1;
  }
  return count + 1;
}

async function appendTickLedgerBestEffort(args: {
  manifestPath: string;
  reason: string;
  entry: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const envelope = await callTool("tick_ledger_append", tick_ledger_append as unknown as ToolWithExecute, {
      manifest_path: args.manifestPath,
      entry: args.entry,
      reason: args.reason,
    });
    const ledgerPath = String(envelope.ledger_path ?? "").trim();
    return ledgerPath || null;
  } catch (error) {
    console.error(`warn.tick_ledger: ${String(error)}`);
    return null;
  }
}

async function appendTelemetryBestEffort(args: {
  manifestPath: string;
  reason: string;
  event: Record<string, unknown>;
}): Promise<void> {
  try {
    await callTool("telemetry_append", telemetry_append as unknown as ToolWithExecute, {
      manifest_path: args.manifestPath,
      event: args.event,
      reason: args.reason,
    });
  } catch (error) {
    console.error(`warn.telemetry_append: ${String(error)}`);
  }
}

async function writeRunMetricsBestEffort(args: {
  manifestPath: string;
  reason: string;
  tickIndex: number;
  stageBefore: string;
  stageAfter: string;
}): Promise<string | null> {
  const boundary = args.stageBefore !== args.stageAfter;
  if (!boundary && args.tickIndex % TICK_METRICS_INTERVAL !== 0) return null;

  try {
    const envelope = await callTool("run_metrics_write", run_metrics_write as unknown as ToolWithExecute, {
      manifest_path: args.manifestPath,
      reason: args.reason,
    });
    const metricsPath = String(envelope.metrics_path ?? "").trim();
    return metricsPath || null;
  } catch (error) {
    console.error(`warn.run_metrics_write: ${String(error)}`);
    return null;
  }
}

export async function beginTickObservability(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
}): Promise<TickObservabilityContext> {
  const manifest = await readJsonObject(args.manifestPath);
  const summary = await summarizeManifest(manifest);
  const logsDirAbs = await resolveLogsDirFromManifest(manifest);
  const telemetryPath = path.join(logsDirAbs, "telemetry.jsonl");
  const tickIndex = await nextTickIndex(logsDirAbs);
  const stageAttempt = await nextStageAttempt(telemetryPath, summary.stageCurrent);
  const manifestRevision = safePositiveInt(manifest.revision, 1);
  const stageStartedDigest = stableDigest({
    schema: "tick.stage_started.inputs.v1",
    run_id: summary.runId,
    stage: summary.stageCurrent,
    tick_index: tickIndex,
    stage_attempt: stageAttempt,
    manifest_revision: manifestRevision,
  });

  const context: TickObservabilityContext = {
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    runId: summary.runId,
    runRoot: summary.runRoot,
    logsDirAbs,
    telemetryPath,
    stageBefore: summary.stageCurrent,
    statusBefore: summary.status,
    stageAttempt,
    tickIndex,
    stageStartedDigest,
    startedAtMs: Date.now(),
  };

  await appendTickLedgerBestEffort({
    manifestPath: args.manifestPath,
    reason: `${args.reason} [tick_${tickIndex}_start]`,
    entry: {
      tick_index: tickIndex,
      phase: "start",
      stage_before: context.stageBefore,
      stage_after: context.stageBefore,
      status_before: context.statusBefore,
      status_after: context.statusBefore,
      result: { ok: true },
      inputs_digest: stageStartedDigest,
      artifacts: {
        manifest_path: args.manifestPath,
        gates_path: args.gatesPath,
        telemetry_path: context.telemetryPath,
      },
    },
  });

  await appendTelemetryBestEffort({
    manifestPath: args.manifestPath,
    reason: `${args.reason} [tick_${tickIndex}_stage_started]`,
    event: {
      event_type: "stage_started",
      stage_id: context.stageBefore,
      stage_attempt: context.stageAttempt,
      inputs_digest: context.stageStartedDigest,
      message: `tick ${tickIndex} started`,
    },
  });

  return context;
}

export async function finalizeTickObservability(args: {
  context: TickObservabilityContext;
  tickResult: TickResultLike;
  reason: string;
  toolError: { code: string; message: string } | null;
}): Promise<void> {
  const manifestAfter = await readJsonObject(args.context.manifestPath);
  const afterSummary = await summarizeManifest(manifestAfter);
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - args.context.startedAtMs) / 1000));
  const tickError = args.toolError ?? resultErrorDetails(args.tickResult);
  const outcome = computeTickOutcome({
    tickResult: args.tickResult,
    stageBefore: args.context.stageBefore,
    stageAfter: afterSummary.stageCurrent,
    statusAfter: afterSummary.status,
    toolError: args.toolError,
  });

  await appendTelemetryBestEffort({
    manifestPath: args.context.manifestPath,
    reason: `${args.reason} [tick_${args.context.tickIndex}_stage_finished]`,
    event: {
      event_type: "stage_finished",
      stage_id: args.context.stageBefore,
      stage_attempt: args.context.stageAttempt,
      outcome: outcome.outcome,
      elapsed_s: elapsedSeconds,
      ...(outcome.failureKind ? { failure_kind: outcome.failureKind } : {}),
      ...(typeof outcome.retryable === "boolean" ? { retryable: outcome.retryable } : {}),
      ...(outcome.message ? { message: outcome.message } : {}),
    },
  });

  const shouldPlanRetry = outcome.outcome === "failed"
    && outcome.retryable === true
    && afterSummary.status === "running";

  if (shouldPlanRetry) {
    await appendTelemetryBestEffort({
      manifestPath: args.context.manifestPath,
      reason: `${args.reason} [tick_${args.context.tickIndex}_stage_retry_planned]`,
      event: {
        event_type: "stage_retry_planned",
        stage_id: args.context.stageBefore,
        from_attempt: args.context.stageAttempt,
        to_attempt: args.context.stageAttempt + 1,
        retry_index: args.context.stageAttempt,
        change_summary: `tick ${args.context.tickIndex} did not advance stage; retry planned`,
      },
    });
  }

  const metricsPath = await writeRunMetricsBestEffort({
    manifestPath: args.context.manifestPath,
    reason: `${args.reason} [tick_${args.context.tickIndex}_metrics]`,
    tickIndex: args.context.tickIndex,
    stageBefore: args.context.stageBefore,
    stageAfter: afterSummary.stageCurrent,
  });

  await appendTickLedgerBestEffort({
    manifestPath: args.context.manifestPath,
    reason: `${args.reason} [tick_${args.context.tickIndex}_finish]`,
    entry: {
      tick_index: args.context.tickIndex,
      phase: "finish",
      stage_before: args.context.stageBefore,
      stage_after: afterSummary.stageCurrent,
      status_before: args.context.statusBefore,
      status_after: afterSummary.status,
      result: tickError
        ? { ok: false, error: { code: tickError.code, message: tickError.message } }
        : { ok: true },
      inputs_digest: args.tickResult.ok
        ? (typeof args.tickResult.decision_inputs_digest === "string" && args.tickResult.decision_inputs_digest.trim()
          ? args.tickResult.decision_inputs_digest
          : args.context.stageStartedDigest)
        : args.context.stageStartedDigest,
      artifacts: {
        manifest_path: args.context.manifestPath,
        gates_path: args.context.gatesPath,
        telemetry_path: args.context.telemetryPath,
        ...(metricsPath ? { metrics_path: metricsPath } : {}),
      },
    },
  });
}
