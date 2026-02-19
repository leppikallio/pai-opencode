import { tool } from "@opencode-ai/plugin";

import {
  GATE_RETRY_CAPS_V1,
  type GateId,
  type ToolWithExecute,
  err,
  errorCode,
  isInteger,
  isPlainObject,
  nowIso,
  ok,
  parseJsonSafe,
  readJson,
  validateManifestV1,
} from "./lifecycle_lib";
import { manifest_write } from "./manifest_write";

export const retry_record = tool({
  description: "Record a bounded retry attempt for a gate",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    gate_id: tool.schema.enum(["A", "B", "C", "D", "E", "F"]).describe("Gate id"),
    change_note: tool.schema.string().describe("Material change for this retry"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; gate_id: GateId; change_note: string; reason: string }) {
    try {
      const changeNote = args.change_note.trim();
      const reason = args.reason.trim();
      if (!changeNote) return err("INVALID_ARGS", "change_note must be non-empty");
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const manifestRaw = await readJson(args.manifest_path);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const metrics = isPlainObject(manifest.metrics) ? (manifest.metrics as Record<string, unknown>) : {};
      const retryCounts = isPlainObject(metrics.retry_counts) ? (metrics.retry_counts as Record<string, unknown>) : {};
      const currentRaw = retryCounts[args.gate_id];
      const current = isInteger(currentRaw) && currentRaw >= 0 ? currentRaw : 0;
      const max = GATE_RETRY_CAPS_V1[args.gate_id];

      if (current >= max) {
        return err("RETRY_EXHAUSTED", `retry cap exhausted for gate ${args.gate_id}`, {
          gate_id: args.gate_id,
          retry_count: current,
          max_retries: max,
        });
      }

      const next = current + 1;
      const retryHistory = Array.isArray(metrics.retry_history) ? metrics.retry_history : [];
      const retryEntry = {
        ts: nowIso(),
        gate_id: args.gate_id,
        attempt: next,
        change_note: changeNote,
        reason,
      };

      const patch = {
        metrics: {
          ...metrics,
          retry_counts: {
            ...retryCounts,
            [args.gate_id]: next,
          },
          retry_history: [...retryHistory, retryEntry],
        },
      };

      const writeRaw = (await (manifest_write as unknown as ToolWithExecute).execute({
        manifest_path: args.manifest_path,
        patch,
        reason: `retry_record(${args.gate_id}#${next}): ${reason}`,
      })) as string;
      const writeObj = parseJsonSafe(writeRaw);

      if (!writeObj.ok) {
        return err("WRITE_FAILED", "failed to parse manifest_write response", { raw: writeObj.value });
      }

      if (!isPlainObject(writeObj.value) || writeObj.value.ok !== true) return JSON.stringify(writeObj.value, null, 2);
      const writeValue = writeObj.value;

      return ok({
        gate_id: args.gate_id,
        retry_count: next,
        max_retries: max,
        attempt: next,
        audit_written: Boolean(writeValue.audit_written),
        audit_path: typeof writeValue.audit_path === "string" ? writeValue.audit_path : null,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path not found");
      return err("WRITE_FAILED", "retry_record failed", { message: String(e) });
    }
  },
});
