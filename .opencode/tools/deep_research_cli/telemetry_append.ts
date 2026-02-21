import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "../../plugins/lib/paths";

import { appendAuditJsonl } from "./citations_lib";
import { resolveRunRootFromManifest } from "./deep_research_shared_lib";
import { validateManifestV1 } from "./schema_v1";
import {
  TELEMETRY_SCHEMA_VERSION,
  canonicalJsonLine,
  telemetryPathFromManifest,
  validateTelemetryEventV1,
} from "./telemetry_lib";
import { readJsonlObjects } from "./citations_validate_lib";
import {
  err,
  errorCode,
  isInteger,
  isPlainObject,
  nowIso,
  ok,
  readJson,
  sha256DigestForJson,
} from "./utils";

export const telemetry_append = tool({
  description: "Append canonical telemetry event to run log",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    event: tool.schema.record(tool.schema.string(), tool.schema.unknown()).describe("Telemetry event object"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; event: Record<string, unknown>; reason: string }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");
      if (!isPlainObject(args.event)) return err("INVALID_ARGS", "event must be object");

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);
      const telemetryPath = telemetryPathFromManifest(runRoot, manifest);

      const existingEvents = await readJsonlObjects(telemetryPath).catch((readErr) => {
        if (errorCode(readErr) === "ENOENT") return [] as Array<Record<string, unknown>>;
        throw readErr;
      });

      let maxSeq = 0;
      let previousSeq = 0;
      for (let i = 0; i < existingEvents.length; i += 1) {
        const event = existingEvents[i] as Record<string, unknown>;
        const existingSeq = event.seq;
        if (!isInteger(existingSeq) || existingSeq <= 0) {
          return err("SCHEMA_VALIDATION_FAILED", "existing telemetry seq must be positive integer", {
            telemetry_path: telemetryPath,
            index: i,
            seq: event.seq ?? null,
          });
        }
        if (existingSeq <= previousSeq) {
          return err("SCHEMA_VALIDATION_FAILED", "telemetry stream must be strictly increasing by seq", {
            telemetry_path: telemetryPath,
            index: i,
            previous_seq: previousSeq,
            seq: existingSeq,
          });
        }
        previousSeq = existingSeq;
        if (existingSeq > maxSeq) maxSeq = existingSeq;
      }

      const nextSeq = maxSeq + 1;
      const event = { ...args.event };
      if (event.schema_version === undefined) event.schema_version = TELEMETRY_SCHEMA_VERSION;
      if (event.run_id === undefined) event.run_id = runId;
      if (event.seq === undefined) event.seq = nextSeq;
      if (event.ts === undefined) event.ts = nowIso();

      const validation = validateTelemetryEventV1(event, runId);
      if (!validation.ok) return err(validation.code, validation.message, validation.details);

      if (!isInteger(event.seq) || event.seq <= maxSeq) {
        return err("SCHEMA_VALIDATION_FAILED", "event.seq must be strictly greater than existing max seq", {
          max_seq: maxSeq,
          seq: event.seq ?? null,
        });
      }

      await ensureDir(path.dirname(telemetryPath));
      await fs.promises.appendFile(telemetryPath, canonicalJsonLine(event), "utf8");

      const inputsDigest = sha256DigestForJson({
        schema: "telemetry_append.inputs.v1",
        run_id: runId,
        event,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "telemetry_append",
            run_id: runId,
            reason,
            seq: event.seq,
            event_type: event.event_type ?? null,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        telemetry_path: telemetryPath,
        seq: event.seq,
        event_type: event.event_type ?? null,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path not found");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid telemetry stream", { message: String(e) });
      return err("WRITE_FAILED", "telemetry_append failed", { message: String(e) });
    }
  },
});

export const deep_research_telemetry_append = telemetry_append;
