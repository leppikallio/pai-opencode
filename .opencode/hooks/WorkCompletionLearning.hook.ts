#!/usr/bin/env bun
import { readStdinWithTimeout } from "./lib/stdin";

import {
  captureWorkCompletionSummary,
  extractLearningsFromWork,
} from "../plugins/handlers/learning-capture";
import { isEnvFlagEnabled } from "../plugins/lib/env-flags";

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

type HookInput = {
  session_id?: string;
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
    };
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  try {
    const rawInput = await readStdinWithTimeout({ timeoutMs: 2000 });
    const input = parseHookInput(rawInput);
    const sessionId = input.session_id;
    if (!sessionId) {
      return;
    }

    await captureWorkCompletionSummary(sessionId);

    if (isEnvFlagEnabled("PAI_ENABLE_FINE_GRAIN_LEARNINGS", false)) {
      await extractLearningsFromWork(sessionId);
    }
  } catch {
    // Hooks must never throw.
  }
}

await main();
process.exit(0);
