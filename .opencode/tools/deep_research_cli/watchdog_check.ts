import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "../../plugins/lib/paths";

import {
  MANIFEST_STAGE,
  STAGE_TIMEOUT_SECONDS_V1,
  type ToolWithExecute,
  atomicWriteJson,
  err,
  errorCode,
  getManifestArtifacts,
  getManifestPaths,
  getStringProp,
  isInteger,
  isPlainObject,
  ok,
  parseJsonSafe,
  readJson,
  validateManifestV1,
} from "./lifecycle_lib";
import { manifest_write } from "./manifest_write";
import { readRunPolicyFromManifest } from "./run_policy_read";

export const watchdog_check = tool({
  description: "Check stage timeout and fail run deterministically",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    stage: tool.schema.string().optional().describe("Optional stage override; defaults to manifest.stage.current"),
    now_iso: tool.schema.string().optional().describe("Optional current time override for deterministic tests"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; stage?: string; now_iso?: string; reason: string }) {
    try {
      const reason = args.reason.trim();
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const manifestRaw = await readJson(args.manifest_path);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const manifestRevision = Number(manifest.revision ?? Number.NaN);
      if (!Number.isFinite(manifestRevision)) {
        return err("INVALID_STATE", "manifest.revision invalid", {
          revision: manifest.revision ?? null,
        });
      }
      const stageObj2 = isPlainObject(manifest.stage) ? (manifest.stage as Record<string, unknown>) : {};
      const currentStage = String(stageObj2.current ?? "");
      const stageArg = (args.stage ?? "").trim();
      const stage = stageArg || currentStage;

      if (!stage || !MANIFEST_STAGE.includes(stage)) {
        return err("INVALID_ARGS", "stage is invalid", { stage });
      }

      if (stageArg && stageArg !== currentStage) {
        return err("STAGE_MISMATCH", "stage override must match manifest.stage.current", {
          requested_stage: stageArg,
          current_stage: currentStage,
        });
      }

      const resolvedPolicy = await readRunPolicyFromManifest({
        manifest_path: args.manifest_path,
        manifest,
      });
      const timeout_s = resolvedPolicy.policy.stage_timeouts_seconds_v1[stage] ?? STAGE_TIMEOUT_SECONDS_V1[stage];
      if (!isInteger(timeout_s) || timeout_s <= 0) {
        return err("INVALID_STATE", "no timeout configured for stage", { stage });
      }

      const now = args.now_iso ? new Date(args.now_iso) : new Date();
      if (Number.isNaN(now.getTime())) {
        return err("INVALID_ARGS", "now_iso must be a valid ISO timestamp", { now_iso: args.now_iso ?? null });
      }

      const stageObj3 = isPlainObject(manifest.stage) ? (manifest.stage as Record<string, unknown>) : {};
      const startedAtRaw = String(stageObj3.started_at ?? "");
      const startedAt = new Date(startedAtRaw);
      if (!startedAtRaw || Number.isNaN(startedAt.getTime())) {
        return err("INVALID_STATE", "manifest.stage.started_at invalid", { started_at: startedAtRaw });
      }

      const lastProgressRaw = String(stageObj3.last_progress_at ?? "").trim();
      let lastProgressAt: Date | null = null;
      if (lastProgressRaw) {
        const parsed = new Date(lastProgressRaw);
        if (Number.isNaN(parsed.getTime())) {
          return err("INVALID_STATE", "manifest.stage.last_progress_at invalid", {
            last_progress_at: lastProgressRaw,
          });
        }
        lastProgressAt = parsed;
      }

      const timerOrigin =
        lastProgressAt && lastProgressAt.getTime() > startedAt.getTime()
          ? lastProgressAt
          : startedAt;
      const timerOriginField = timerOrigin === startedAt ? "stage.started_at" : "stage.last_progress_at";

      const elapsed_s = Math.max(0, Math.floor((now.getTime() - timerOrigin.getTime()) / 1000));

      const status = String((manifest as Record<string, unknown>).status ?? "").trim();
      if (status === "paused") {
        return ok({
          timed_out: false,
          stage,
          elapsed_s,
          timeout_s,
          timeout_policy_source: resolvedPolicy.source,
          timer_origin: timerOrigin.toISOString(),
          timer_origin_field: timerOriginField,
          paused: true,
        });
      }

      if (elapsed_s <= timeout_s) {
        return ok({
          timed_out: false,
          stage,
          elapsed_s,
          timeout_s,
          timeout_policy_source: resolvedPolicy.source,
          timer_origin: timerOrigin.toISOString(),
          timer_origin_field: timerOriginField,
        });
      }

      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? "");
      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "manifest.artifacts.root invalid", { root: runRoot });
      }

      const logsDir = String(getManifestPaths(manifest).logs_dir ?? "logs");
      const checkpointPath = path.join(runRoot, logsDir, "timeout-checkpoint.md");
      const checkpointJsonPath = path.join(runRoot, logsDir, "timeout-checkpoint.json");
      const failureTs = now.toISOString();

      const checkpointContent = `${[
        "# Timeout Checkpoint",
        "",
        `- stage: ${stage}`,
        `- elapsed_seconds: ${elapsed_s}`,
        `- timeout_seconds: ${timeout_s}`,
        `- timer_origin_field: ${timerOriginField}`,
        `- timer_origin: ${timerOrigin.toISOString()}`,
        `- stage_started_at: ${startedAt.toISOString()}`,
        `- stage_last_progress_at: ${lastProgressAt ? lastProgressAt.toISOString() : "n/a"}`,
        "- last_known_subtask: unavailable (placeholder)",
        "- next_steps:",
        "  1. Inspect logs/audit.jsonl for recent events.",
        "  2. Decide whether to restart this stage or abort run.",
      ].join("\n")}\n`;

      await ensureDir(path.dirname(checkpointPath));
      await fs.promises.writeFile(checkpointPath, checkpointContent, "utf8");
      await atomicWriteJson(checkpointJsonPath, {
        schema_version: "timeout_checkpoint.v1",
        generated_at: failureTs,
        stage,
        elapsed_seconds: elapsed_s,
        timeout_seconds: timeout_s,
        timer_origin_field: timerOriginField,
        timer_origin: timerOrigin.toISOString(),
        stage_started_at: startedAt.toISOString(),
        stage_last_progress_at: lastProgressAt ? lastProgressAt.toISOString() : null,
        last_known_subtask: null,
        next_steps: [
          "Inspect logs/audit.jsonl for recent events.",
          "Decide whether to restart this stage or abort run.",
        ],
      });

      const existingFailures = Array.isArray(manifest.failures) ? manifest.failures : [];
      const patch = {
        status: "failed",
        failures: [
          ...existingFailures,
          {
            kind: "timeout",
            stage,
            message: `timeout after ${elapsed_s}s`,
            retryable: false,
            ts: failureTs,
          },
        ],
      };

      const writeRaw = (await (manifest_write as unknown as ToolWithExecute).execute({
        manifest_path: args.manifest_path,
        patch,
        expected_revision: manifestRevision,
        reason: `watchdog_check: ${reason}`,
      })) as string;

      const writeObj = parseJsonSafe(writeRaw);
      if (!writeObj.ok) {
        return err("WRITE_FAILED", "failed to parse manifest_write response", { raw: writeObj.value });
      }

      if (!isPlainObject(writeObj.value) || writeObj.value.ok !== true) return JSON.stringify(writeObj.value, null, 2);

      return ok({
        timed_out: true,
        stage,
        elapsed_s,
        timeout_s,
        timeout_policy_source: resolvedPolicy.source,
        timer_origin: timerOrigin.toISOString(),
        timer_origin_field: timerOriginField,
        checkpoint_path: checkpointPath,
        checkpoint_json_path: checkpointJsonPath,
        manifest_revision: Number((writeObj.value as Record<string, unknown>).new_revision ?? 0),
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path not found");
      return err("WRITE_FAILED", "watchdog_check failed", { message: String(e) });
    }
  },
});
