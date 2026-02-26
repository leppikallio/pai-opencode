#!/usr/bin/env bun
import { readFileSync } from "node:fs";

import { resolveInterrupt } from "./lib/cmux-attention";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStdinBestEffort(): JsonRecord {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return {};
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return asRecord(JSON.parse(trimmed)) ?? {};
  } catch {
    return {};
  }
}

function readSessionId(payload: JsonRecord): string {
  return asString(payload.session_id) ?? asString(payload.sessionId) ?? "unknown-session";
}

try {
  const payload = readStdinBestEffort();
  await resolveInterrupt({
    eventKey: "QUESTION_RESOLVED",
    sessionId: readSessionId(payload),
    reasonShort: "Answered",
  });
} catch {
  // Never throw from hooks.
} finally {
  process.stdout.write('{"continue": true}\n');
  process.exit(0);
}
