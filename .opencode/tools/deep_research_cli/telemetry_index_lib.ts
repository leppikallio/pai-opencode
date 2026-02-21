import * as path from "node:path";

import { readJsonlObjects } from "./citations_validate_lib";
import { atomicWriteJson, errorCode, isInteger, isPlainObject, readJson } from "./utils";

export const TELEMETRY_INDEX_SCHEMA_VERSION = "telemetry_index.v1";

type TelemetryIndexOutcome =
  | {
      ok: true;
      index_path: string;
      last_seq: number;
    }
  | {
      ok: false;
      code: string;
      message: string;
      details: Record<string, unknown>;
    };

export function telemetryIndexPathFromTelemetryPath(telemetryPath: string): string {
  return path.join(path.dirname(telemetryPath), "telemetry.index.json");
}

function invalidIndex(indexPath: string, reason: string, value: unknown): TelemetryIndexOutcome {
  return {
    ok: false,
    code: "SCHEMA_VALIDATION_FAILED",
    message: reason,
    details: {
      telemetry_index_path: indexPath,
      value,
    },
  };
}

function validateTelemetryIndex(indexPath: string, raw: unknown): TelemetryIndexOutcome {
  if (!isPlainObject(raw)) return invalidIndex(indexPath, "telemetry index must be object", raw);
  const schemaVersion = raw.schema_version;
  if (schemaVersion !== TELEMETRY_INDEX_SCHEMA_VERSION) {
    return invalidIndex(indexPath, "telemetry index schema_version invalid", schemaVersion ?? null);
  }

  const lastSeq = raw.last_seq;
  if (!isInteger(lastSeq) || lastSeq < 0) {
    return invalidIndex(indexPath, "telemetry index last_seq must be integer >= 0", lastSeq ?? null);
  }

  return {
    ok: true,
    index_path: indexPath,
    last_seq: lastSeq,
  };
}

async function deriveLastSeqFromTelemetry(telemetryPath: string): Promise<TelemetryIndexOutcome> {
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
      return {
        ok: false,
        code: "SCHEMA_VALIDATION_FAILED",
        message: "existing telemetry seq must be positive integer",
        details: {
          telemetry_path: telemetryPath,
          index: i,
          seq: event.seq ?? null,
        },
      };
    }
    if (existingSeq <= previousSeq) {
      return {
        ok: false,
        code: "SCHEMA_VALIDATION_FAILED",
        message: "telemetry stream must be strictly increasing by seq",
        details: {
          telemetry_path: telemetryPath,
          index: i,
          previous_seq: previousSeq,
          seq: existingSeq,
        },
      };
    }
    previousSeq = existingSeq;
    if (existingSeq > maxSeq) maxSeq = existingSeq;
  }

  return {
    ok: true,
    index_path: telemetryIndexPathFromTelemetryPath(telemetryPath),
    last_seq: maxSeq,
  };
}

export async function readOrCreateTelemetryIndex(telemetryPath: string): Promise<TelemetryIndexOutcome> {
  const indexPath = telemetryIndexPathFromTelemetryPath(telemetryPath);
  try {
    const existing = await readJson(indexPath);
    return validateTelemetryIndex(indexPath, existing);
  } catch (e) {
    if (errorCode(e) !== "ENOENT") throw e;
  }

  const derived = await deriveLastSeqFromTelemetry(telemetryPath);
  if (!derived.ok) return derived;

  await atomicWriteJson(indexPath, {
    schema_version: TELEMETRY_INDEX_SCHEMA_VERSION,
    last_seq: derived.last_seq,
  });

  return {
    ok: true,
    index_path: indexPath,
    last_seq: derived.last_seq,
  };
}

export async function writeTelemetryIndex(indexPath: string, lastSeq: number): Promise<TelemetryIndexOutcome> {
  if (!isInteger(lastSeq) || lastSeq < 0) {
    return invalidIndex(indexPath, "telemetry index last_seq must be integer >= 0", lastSeq);
  }

  await atomicWriteJson(indexPath, {
    schema_version: TELEMETRY_INDEX_SCHEMA_VERSION,
    last_seq: lastSeq,
  });

  return {
    ok: true,
    index_path: indexPath,
    last_seq: lastSeq,
  };
}
