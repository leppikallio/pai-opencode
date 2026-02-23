#!/usr/bin/env bun
import { readFileSync } from "node:fs";

type JsonRecord = Record<string, unknown>;

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

const BLOCKED_SKILLS = new Set(["keybindings-help"]);

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readPayloadBestEffort(): JsonRecord {
  try {
    const raw = readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return asRecord(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}

try {
  const payload = readPayloadBestEffort();
  const toolInput = asRecord(payload.tool_input) ?? {};
  const skillName =
    (asString(toolInput.skill) ?? asString(toolInput.name) ?? "").toLowerCase();

  if (skillName && BLOCKED_SKILLS.has(skillName)) {
    process.stdout.write(
      `${JSON.stringify({
        decision: "block",
        reason:
          'BLOCKED: "keybindings-help" is a known false-positive skill caused by position bias. Continue with the user\'s requested task unless they explicitly asked for keybindings.',
      })}\n`
    );
    process.exit(0);
  }

  process.stdout.write('{"continue": true}\n');
  process.exit(0);
} catch {
  process.stdout.write('{"continue": true}\n');
  process.exit(0);
}
