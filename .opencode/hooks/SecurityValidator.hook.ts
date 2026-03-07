#!/usr/bin/env bun
import { readFileSync } from "node:fs";

import type { ToolInput } from "../plugins/adapters/types";
import {
  createSecurityPermissionDecisionFromError,
  createSecurityPermissionDecisionFromResult,
  type SecurityPermissionDecision,
} from "../plugins/security/adapter-decision";

type JsonRecord = Record<string, unknown>;

export type SecurityHookProcessResult = {
  exitCode: 0 | 2;
  stdout?: string;
  stderr?: string;
};

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

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function createSecurityHookProcessResult(
  decision: SecurityPermissionDecision,
): SecurityHookProcessResult {
  if (decision.status === "allow") {
    return {
      exitCode: 0,
      stdout: jsonLine({ continue: true }),
    };
  }

  if (decision.status === "ask") {
    return {
      exitCode: 0,
      stdout: jsonLine({
        decision: "ask",
        reason: decision.reason,
      }),
    };
  }

  return {
    exitCode: 2,
    stderr: `${decision.reason ?? "Blocked by security policy"}\n`,
  };
}

export function writeSecurityHookProcessResult(result: SecurityHookProcessResult): never {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  process.exit(result.exitCode);
}

export async function runSecurityValidatorHookFromStdin(): Promise<SecurityHookProcessResult> {
  const payload = readPayloadStrict();
  const toolName = payload ? asString(payload.tool_name) : undefined;

  if (!payload || !toolName) {
    return createSecurityHookProcessResult({
      status: "ask",
      reason: "Security validator: missing/invalid hook payload",
    });
  }

  const toolArgs = asRecord(payload.tool_input) ?? {};

  const input: ToolInput = {
    tool: toolName,
    args: toolArgs,
    cwd: asString(payload.cwd),
    sessionID: asString(payload.session_id),
    callID: asString(payload.tool_use_id),
  };

  try {
    const { validateSecurity } = await import("../plugins/handlers/security-validator");
    const result = await validateSecurity(input);
    return createSecurityHookProcessResult(createSecurityPermissionDecisionFromResult(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...createSecurityHookProcessResult(createSecurityPermissionDecisionFromError(error)),
      stderr: `[SecurityValidator] ${message}\n`,
    };
  }
}

if (import.meta.main) {
  writeSecurityHookProcessResult(await runSecurityValidatorHookFromStdin());
}
