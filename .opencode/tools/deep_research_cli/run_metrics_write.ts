import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import { appendAuditJsonl, toPosixPath } from "./citations_lib";
import { atomicWriteCanonicalJson, resolveRunRootFromManifest } from "./deep_research_shared_lib";
import { MANIFEST_STAGE, validateManifestV1 } from "./schema_v1";
import {
  telemetryPathFromManifest,
  validateTelemetryEventV1,
} from "./telemetry_lib";
import { readOrCreateTelemetryIndex } from "./telemetry_index_lib";
import { readJsonlObjects } from "./citations_validate_lib";
import {
  err,
  errorCode,
  isInteger,
  isPlainObject,
  nowIso,
  ok,
  readJson,
  resolveRunPath,
  sha256DigestForJson,
} from "./utils";

export const run_metrics_write = tool({
  description: "Compute deterministic run metrics from telemetry",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    telemetry_path: tool.schema.string().optional().describe("Optional telemetry.jsonl path"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; telemetry_path?: string; reason: string }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);

      const telemetryInput = (args.telemetry_path ?? "").trim();
      const telemetryPath = telemetryInput
        ? resolveRunPath(runRoot, telemetryInput)
        : telemetryPathFromManifest(runRoot, manifest);

      if (!path.isAbsolute(telemetryPath)) {
        return err("INVALID_ARGS", "telemetry_path resolved to non-absolute path", {
          telemetry_path: args.telemetry_path ?? null,
        });
      }

      const telemetryIndex = await readOrCreateTelemetryIndex(telemetryPath);
      if (!telemetryIndex.ok) {
        return err(telemetryIndex.code, telemetryIndex.message, telemetryIndex.details);
      }
      const telemetryLastSeq = telemetryIndex.last_seq;

      const metricsPath = path.join(runRoot, "metrics", "run-metrics.json");
      try {
        const existingMetricsRaw = await readJson(metricsPath);
        if (isPlainObject(existingMetricsRaw)) {
          const existingRun = isPlainObject(existingMetricsRaw.run)
            ? (existingMetricsRaw.run as Record<string, unknown>)
            : null;
          const existingLastSeq = existingRun?.last_seq;
          if (isInteger(existingLastSeq) && existingLastSeq === telemetryLastSeq) {
            try {
              await appendAuditJsonl({
                runRoot,
                event: {
                  ts: nowIso(),
                  kind: "run_metrics_write",
                  run_id: runId,
                  reason,
                  telemetry_path: toPosixPath(path.relative(runRoot, telemetryPath)),
                  metrics_path: toPosixPath(path.relative(runRoot, metricsPath)),
                  skipped: true,
                  skip_reason: "telemetry unchanged",
                  last_seq: telemetryLastSeq,
                },
              });
            } catch {
              // best effort
            }

            return ok({
              metrics_path: metricsPath,
              telemetry_path: telemetryPath,
              skipped: true,
              reason: "telemetry unchanged",
              last_seq: telemetryLastSeq,
            });
          }
        }
      } catch {
        // continue with full metrics recompute
      }

      const events = await readJsonlObjects(telemetryPath);
      const seenSeq = new Set<number>();
      const validated: Array<Record<string, unknown>> = [];

      for (let i = 0; i < events.length; i += 1) {
        const event = events[i] as Record<string, unknown>;
        const validation = validateTelemetryEventV1(event, runId);
        if (!validation.ok) {
          return err(validation.code, validation.message, {
            ...validation.details,
            telemetry_path: telemetryPath,
            line: i + 1,
          });
        }

        const seq = Number(event.seq);
        if (seenSeq.has(seq)) {
          return err("SCHEMA_VALIDATION_FAILED", "telemetry seq must be unique", {
            telemetry_path: telemetryPath,
            seq,
          });
        }
        seenSeq.add(seq);
        validated.push(event);
      }

      validated.sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));

      const attemptsByStageId: Record<string, number> = {};
      const retriesByStageId: Record<string, number> = {};
      const failuresByStageId: Record<string, number> = {};
      const timeoutsByStageId: Record<string, number> = {};
      const durationByStageId: Record<string, number> = {};
      for (const stageId of MANIFEST_STAGE) {
        attemptsByStageId[stageId] = 0;
        retriesByStageId[stageId] = 0;
        failuresByStageId[stageId] = 0;
        timeoutsByStageId[stageId] = 0;
        durationByStageId[stageId] = 0;
      }

      let runStatus = String(manifest.status ?? "created");
      let firstRunningTsMs: number | null = null;
      let lastRunStatusTsMs: number | null = null;
      let stagesStartedTotal = 0;
      let stagesFinishedTotal = 0;
      let stageTimeoutsTotal = 0;
      let failuresTotal = 0;

      for (const event of validated) {
        const eventType = String(event.event_type ?? "");
        const stageId = String(event.stage_id ?? "");

        if (eventType === "run_status") {
          runStatus = String(event.status ?? runStatus);
          const tsMs = new Date(String(event.ts ?? "")).getTime();
          if (String(event.status ?? "") === "running" && firstRunningTsMs === null) firstRunningTsMs = tsMs;
          lastRunStatusTsMs = tsMs;
          continue;
        }

        if (eventType === "stage_started") {
          stagesStartedTotal += 1;
          const attempt = Number(event.stage_attempt ?? 0);
          if (attempt > attemptsByStageId[stageId]) attemptsByStageId[stageId] = attempt;
          continue;
        }

        if (eventType === "stage_finished") {
          stagesFinishedTotal += 1;
          const elapsed = Number(event.elapsed_s ?? 0);
          durationByStageId[stageId] += elapsed;
          const outcome = String(event.outcome ?? "");
          if (outcome === "failed" || outcome === "timed_out") {
            failuresTotal += 1;
            failuresByStageId[stageId] += 1;
          }
          continue;
        }

        if (eventType === "stage_retry_planned") {
          retriesByStageId[stageId] += 1;
          continue;
        }

        if (eventType === "watchdog_timeout") {
          stageTimeoutsTotal += 1;
          timeoutsByStageId[stageId] += 1;
        }
      }

      if (runStatus !== "running" && stagesStartedTotal !== stagesFinishedTotal) {
        return err("SCHEMA_VALIDATION_FAILED", "run.stages_started_total must equal run.stages_finished_total unless status=running", {
          run_status: runStatus,
          stages_started_total: stagesStartedTotal,
          stages_finished_total: stagesFinishedTotal,
        });
      }

      const runDurationS = firstRunningTsMs !== null && lastRunStatusTsMs !== null && lastRunStatusTsMs >= firstRunningTsMs
        ? Math.floor((lastRunStatusTsMs - firstRunningTsMs) / 1000)
        : 0;

      const runMetrics = {
        status: runStatus,
        duration_s: runDurationS,
        stages_started_total: stagesStartedTotal,
        stages_finished_total: stagesFinishedTotal,
        stage_timeouts_total: stageTimeoutsTotal,
        failures_total: failuresTotal,
        last_seq: telemetryLastSeq,
      };

      const stageMetrics = {
        attempts_total: { by_stage_id: attemptsByStageId },
        retries_total: { by_stage_id: retriesByStageId },
        failures_total: { by_stage_id: failuresByStageId },
        timeouts_total: { by_stage_id: timeoutsByStageId },
        duration_s: { by_stage_id: durationByStageId },
      };

      const inputsDigest = sha256DigestForJson({
        schema: "run_metrics_write.inputs.v1",
        run_id: runId,
        telemetry_events: validated,
      });

      const metricsDoc = {
        schema_version: "run_metrics.v1",
        run_id: runId,
        inputs_digest: inputsDigest,
        run: runMetrics,
        stage: stageMetrics,
      };

      await atomicWriteCanonicalJson(metricsPath, metricsDoc);

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "run_metrics_write",
            run_id: runId,
            reason,
            telemetry_path: toPosixPath(path.relative(runRoot, telemetryPath)),
            metrics_path: toPosixPath(path.relative(runRoot, metricsPath)),
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        metrics_path: metricsPath,
        telemetry_path: telemetryPath,
        run: runMetrics,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required telemetry or manifest file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid telemetry JSONL", { message: String(e) });
      return err("WRITE_FAILED", "run_metrics_write failed", { message: String(e) });
    }
  },
});

export const deep_research_run_metrics_write = run_metrics_write;
