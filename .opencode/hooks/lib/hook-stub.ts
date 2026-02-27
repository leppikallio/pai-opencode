#!/usr/bin/env bun
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getPaiDir } from "./paths";

type HookPayload = Record<string, unknown> | null;

function readStdinBestEffort(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parsePayload(raw: string): HookPayload {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // best-effort parse only
  }

  return { raw_stdin: raw };
}

function inferHookEventName(payload: HookPayload): string {
  if (!payload) return "unknown";

  const hookEventName = payload.hook_event_name;
  if (typeof hookEventName === "string" && hookEventName.trim()) return hookEventName;

  const eventName = payload.event_name;
  if (typeof eventName === "string" && eventName.trim()) return eventName;

  const event = payload.event;
  if (typeof event === "string" && event.trim()) return event;

  return "unknown";
}

export async function runHook(args: { hookName: string }): Promise<void> {
  const payload = parsePayload(readStdinBestEffort());
  const paiDir = getPaiDir();
  const logPath = join(paiDir, "MEMORY", "WORK", "pai-cc-hooks-smoke.jsonl");

  const record = {
    timestamp: new Date().toISOString(),
    hook_file: args.hookName,
    hook_event_name: inferHookEventName(payload),
    payload,
  };

  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
  process.stdout.write('{"continue": true}\n');
}
