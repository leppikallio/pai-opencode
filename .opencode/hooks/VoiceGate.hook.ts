#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";

import { getPaiDir } from "./lib/paths";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function getString(obj: UnknownRecord, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function readJsonStdin(): UnknownRecord {
  try {
    const raw = fs.readFileSync(0, "utf-8");
    if (!raw.trim()) return {};
    return asRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

function getBackgroundTaskStatePath(): string {
  return path.join(getPaiDir(), "MEMORY", "STATE", "background-tasks.json");
}

function collectChildSessionIds(state: unknown): Set<string> {
  const out = new Set<string>();
  const root = asRecord(state);
  const backgroundTasks = asRecord(root.backgroundTasks);
  for (const record of Object.values(backgroundTasks)) {
    const task = asRecord(record);
    const child = getString(task, "child_session_id") ?? getString(task, "childSessionId");
    if (child) out.add(child);
  }
  return out;
}

function isKnownSubagentSession(sessionId: string): boolean {
  const statePath = getBackgroundTaskStatePath();
  try {
    if (!fs.existsSync(statePath)) return false;
    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw);
    return collectChildSessionIds(parsed).has(sessionId);
  } catch {
    return false;
  }
}

function writeJson(value: unknown): void {
  try {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  } catch {
    // Never throw from hooks.
  }
}

try {
  const payload = readJsonStdin();
  const toolName = getString(payload, "tool_name") ?? "";

  // Only gate VoiceNotify.
  if (toolName !== "VoiceNotify") {
    writeJson({ continue: true });
    process.exit(0);
  }

  const sessionId = getString(payload, "session_id") ?? "";
  const toolInput = asRecord(payload.tool_input);

  // Best-effort local gate: if we can positively identify this as a background
  // subagent session, silently strip message so the tool becomes a no-op.
  if (sessionId && isKnownSubagentSession(sessionId)) {
    writeJson({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: {
          ...toolInput,
          message: "",
        },
      },
    });
    process.exit(0);
  }

  writeJson({ continue: true });
} catch {
  // Never throw from hooks.
} finally {
  process.exit(0);
}
