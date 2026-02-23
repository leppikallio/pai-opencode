#!/usr/bin/env bun
import { readFileSync } from "node:fs";

import type { ToolInput } from "../plugins/adapters/types";

type JsonRecord = Record<string, unknown>;

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readPayloadStrict(): JsonRecord | undefined {
  try {
    const raw = readFileSync(0, "utf8").trim();
    if (!raw) return undefined;
    return asRecord(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

const payload = readPayloadStrict();
const toolName = payload ? asString(payload.tool_name) : undefined;

if (!payload || !toolName) {
  process.stdout.write(
    `${JSON.stringify({
      decision: "ask",
      reason: "Security validator: missing/invalid hook payload",
    })}\n`,
  );
  process.exit(0);
}

const toolArgs = asRecord(payload.tool_input) ?? {};

const input: ToolInput = {
  tool: toolName,
  args: toolArgs,
  sessionID: asString(payload.session_id),
  callID: asString(payload.tool_use_id),
};

try {
  const { validateSecurity } = await import("../plugins/handlers/security-validator");
  const result = await validateSecurity(input);

  if (result.action === "allow") {
    process.stdout.write('{"continue": true}\n');
    process.exit(0);
  }

  if (result.action === "confirm") {
    process.stdout.write(
      `${JSON.stringify({ decision: "ask", reason: result.message ?? result.reason })}\n`
    );
    process.exit(0);
  }

  process.stderr.write(`${result.message ?? result.reason}\n`);
  process.exit(2);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[SecurityValidator] ${message}\n`);
  // Fail-safe: require confirmation when the validator fails unexpectedly.
  process.stdout.write(
    `${JSON.stringify({
      decision: "ask",
      reason: `Security validator error: ${message}`,
    })}\n`,
  );
  process.exit(0);
}
