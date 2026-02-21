import * as path from "node:path";

import { MANIFEST_STAGE, MANIFEST_STATUS, STAGE_TIMEOUT_SECONDS_V1 } from "./schema_v1";
import type { JsonObject } from "./types";
import { canonicalizeJson, getManifestPaths, isInteger, isNonEmptyString } from "./utils";

export const TELEMETRY_SCHEMA_VERSION = "telemetry.v1";
const TELEMETRY_EVENT_TYPES = ["run_status", "stage_started", "stage_finished", "stage_retry_planned", "watchdog_timeout"] as const;
type TelemetryEventType = typeof TELEMETRY_EVENT_TYPES[number];
const TELEMETRY_STAGE_OUTCOMES = ["succeeded", "failed", "timed_out", "cancelled"] as const;
const TELEMETRY_FAILURE_KINDS = ["timeout", "tool_error", "invalid_output", "gate_failed", "unknown"] as const;

export function canonicalJsonLine(value: unknown): string {
  return `${JSON.stringify(canonicalizeJson(value))}\n`;
}

function isTelemetryEventType(value: string): value is TelemetryEventType {
  return (TELEMETRY_EVENT_TYPES as readonly string[]).includes(value);
}

function isValidUtcTimestamp(value: string): boolean {
  if (!value || !value.endsWith("Z")) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function telemetryError(code: string, message: string, details: JsonObject = {}): { code: string; message: string; details: JsonObject } {
  return { code, message, details };
}

export function validateTelemetryEventV1(
  event: Record<string, unknown>,
  expectedRunId: string,
): { ok: true } | { ok: false; code: string; message: string; details: JsonObject } {
  const schemaVersion = String(event.schema_version ?? "").trim();
  if (schemaVersion !== TELEMETRY_SCHEMA_VERSION) {
    return {
      ok: false,
      ...telemetryError("SCHEMA_VALIDATION_FAILED", "event.schema_version must be telemetry.v1", {
        schema_version: event.schema_version ?? null,
      }),
    };
  }

  const runId = String(event.run_id ?? "").trim();
  if (!runId || runId !== expectedRunId) {
    return {
      ok: false,
      ...telemetryError("SCHEMA_VALIDATION_FAILED", "event.run_id must match manifest.run_id", {
        expected_run_id: expectedRunId,
        run_id: event.run_id ?? null,
      }),
    };
  }

  const seq = event.seq;
  if (!isInteger(seq) || seq <= 0) {
    return {
      ok: false,
      ...telemetryError("SCHEMA_VALIDATION_FAILED", "event.seq must be positive integer", {
        seq: event.seq ?? null,
      }),
    };
  }

  const ts = String(event.ts ?? "").trim();
  if (!isValidUtcTimestamp(ts)) {
    return {
      ok: false,
      ...telemetryError("SCHEMA_VALIDATION_FAILED", "event.ts must be RFC3339 UTC timestamp", {
        ts: event.ts ?? null,
      }),
    };
  }

  const eventType = String(event.event_type ?? "").trim();
  if (!isTelemetryEventType(eventType)) {
    return {
      ok: false,
      ...telemetryError("SCHEMA_VALIDATION_FAILED", "event.event_type invalid", {
        event_type: event.event_type ?? null,
      }),
    };
  }

  if (event.message !== undefined && typeof event.message !== "string") {
    return {
      ok: false,
      ...telemetryError("SCHEMA_VALIDATION_FAILED", "event.message must be string when present", {
        message: event.message,
      }),
    };
  }

  if (eventType === "run_status") {
    const status = String(event.status ?? "").trim();
    if (!status || !MANIFEST_STATUS.includes(status)) {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "run_status.status invalid", {
          status: event.status ?? null,
        }),
      };
    }
    return { ok: true };
  }

  const stageId = String(event.stage_id ?? "").trim();
  if (!stageId || !MANIFEST_STAGE.includes(stageId)) {
    return {
      ok: false,
      ...telemetryError("SCHEMA_VALIDATION_FAILED", "event.stage_id invalid", {
        stage_id: event.stage_id ?? null,
      }),
    };
  }

  if (eventType === "stage_started") {
    if (!isInteger(event.stage_attempt) || event.stage_attempt <= 0) {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_started.stage_attempt must be positive integer", {
          stage_attempt: event.stage_attempt ?? null,
        }),
      };
    }
    if (!isNonEmptyString(event.inputs_digest)) {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_started.inputs_digest must be non-empty string", {
          inputs_digest: event.inputs_digest ?? null,
        }),
      };
    }
    return { ok: true };
  }

  if (eventType === "stage_finished") {
    if (!isInteger(event.stage_attempt) || event.stage_attempt <= 0) {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_finished.stage_attempt must be positive integer", {
          stage_attempt: event.stage_attempt ?? null,
        }),
      };
    }

    const outcome = String(event.outcome ?? "").trim();
    if (!(TELEMETRY_STAGE_OUTCOMES as readonly string[]).includes(outcome)) {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_finished.outcome invalid", {
          outcome: event.outcome ?? null,
        }),
      };
    }

    if (!isInteger(event.elapsed_s) || event.elapsed_s < 0) {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_finished.elapsed_s must be integer >= 0", {
          elapsed_s: event.elapsed_s ?? null,
        }),
      };
    }

    if (event.failure_kind !== undefined) {
      const failureKind = String(event.failure_kind ?? "").trim();
      if (!(TELEMETRY_FAILURE_KINDS as readonly string[]).includes(failureKind)) {
        return {
          ok: false,
          ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_finished.failure_kind invalid", {
            failure_kind: event.failure_kind,
          }),
        };
      }
    }

    if (event.retryable !== undefined && typeof event.retryable !== "boolean") {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_finished.retryable must be boolean when present", {
          retryable: event.retryable,
        }),
      };
    }

    if (outcome === "timed_out" && String(event.failure_kind ?? "").trim() !== "timeout") {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_finished timed_out requires failure_kind=timeout", {
          failure_kind: event.failure_kind ?? null,
        }),
      };
    }

    return { ok: true };
  }

  if (eventType === "stage_retry_planned") {
    if (!isInteger(event.from_attempt) || event.from_attempt <= 0) {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_retry_planned.from_attempt must be positive integer", {
          from_attempt: event.from_attempt ?? null,
        }),
      };
    }
    if (!isInteger(event.to_attempt) || event.to_attempt <= 0) {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_retry_planned.to_attempt must be positive integer", {
          to_attempt: event.to_attempt ?? null,
        }),
      };
    }
    if (event.to_attempt <= event.from_attempt) {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_retry_planned.to_attempt must be greater than from_attempt", {
          from_attempt: event.from_attempt,
          to_attempt: event.to_attempt,
        }),
      };
    }
    if (!isInteger(event.retry_index) || event.retry_index <= 0) {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_retry_planned.retry_index must be positive integer", {
          retry_index: event.retry_index ?? null,
        }),
      };
    }
    if (!isNonEmptyString(event.change_summary)) {
      return {
        ok: false,
        ...telemetryError("SCHEMA_VALIDATION_FAILED", "stage_retry_planned.change_summary must be non-empty string", {
          change_summary: event.change_summary ?? null,
        }),
      };
    }
    return { ok: true };
  }

  if (!isInteger(event.timeout_s) || event.timeout_s <= 0) {
    return {
      ok: false,
      ...telemetryError("SCHEMA_VALIDATION_FAILED", "watchdog_timeout.timeout_s must be integer > 0", {
        timeout_s: event.timeout_s ?? null,
      }),
    };
  }
  if (!isInteger(event.elapsed_s) || event.elapsed_s < 0) {
    return {
      ok: false,
      ...telemetryError("SCHEMA_VALIDATION_FAILED", "watchdog_timeout.elapsed_s must be integer >= 0", {
        elapsed_s: event.elapsed_s ?? null,
      }),
    };
  }

  const expectedTimeout = STAGE_TIMEOUT_SECONDS_V1[stageId];
  if (!isInteger(expectedTimeout) || expectedTimeout <= 0 || event.timeout_s !== expectedTimeout) {
    return {
      ok: false,
      ...telemetryError("SCHEMA_VALIDATION_FAILED", "watchdog_timeout.timeout_s must match stage timeout policy", {
        stage_id: stageId,
        timeout_s: event.timeout_s,
        expected_timeout_s: expectedTimeout ?? null,
      }),
    };
  }

  const checkpointRelpath = String(event.checkpoint_relpath ?? "").trim();
  if (!checkpointRelpath) {
    return {
      ok: false,
      ...telemetryError("SCHEMA_VALIDATION_FAILED", "watchdog_timeout.checkpoint_relpath must be non-empty", {
        checkpoint_relpath: event.checkpoint_relpath ?? null,
      }),
    };
  }

  return { ok: true };
}

export function telemetryPathFromManifest(runRoot: string, manifest: Record<string, unknown>): string {
  const paths = getManifestPaths(manifest);
  const logsDir = typeof paths.logs_dir === "string" && paths.logs_dir.trim().length > 0
    ? paths.logs_dir
    : "logs";
  return path.join(runRoot, logsDir, "telemetry.jsonl");
}
