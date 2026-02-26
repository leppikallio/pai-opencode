#!/usr/bin/env bun
import { readStdinWithTimeout } from "./lib/stdin";

import { createWorkSession } from "../plugins/handlers/work-tracker";

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

type HookInput = {
  session_id?: string;
  prompt?: string;
  user_prompt?: string;
};

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseHookInput(raw: string): HookInput {
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      session_id: asString(parsed.session_id),
      prompt: asString(parsed.prompt),
      user_prompt: asString(parsed.user_prompt),
    };
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  try {
    const rawInput = await readStdinWithTimeout({ timeoutMs: 2000 });
    const input = parseHookInput(rawInput);
    const sessionId = asString(input.session_id) ?? "";
    const prompt = input.prompt ?? input.user_prompt ?? "";

    if (!sessionId || !prompt) {
      return;
    }

    // Consolidation: delegate to the OpenCode-native work tracker.
    // This ensures we only have ONE WORK layout and ONE STATE/current-work.json.
    await createWorkSession(sessionId, prompt);
  } catch {
    // Hooks must never throw.
  }
}

await main();
process.exit(0);
