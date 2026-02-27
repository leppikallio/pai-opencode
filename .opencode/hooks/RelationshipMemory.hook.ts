#!/usr/bin/env bun
import { readStdinWithTimeout } from "./lib/stdin";
import { appendThreadExcerptEntry } from "./lib/thread-projections";
import { captureRelationshipMemory } from "../plugins/handlers/relationship-memory";

type HookInput = {
  session_id?: string;
  sessionId?: string;
};

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
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
      sessionId: asString(parsed.sessionId),
    };
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  try {
    const rawInput = await readStdinWithTimeout({ timeoutMs: 2000 });
    const input = parseHookInput(rawInput);
    const sessionId = input.session_id ?? input.sessionId;
    if (!sessionId) {
      return;
    }

    await appendThreadExcerptEntry({
      sessionId,
      outputFileName: "RELATIONSHIP_HOOK.md",
    });

    try {
      await captureRelationshipMemory(sessionId);
    } catch {
      // Best effort by hook contract.
    }
  } catch {
    // Hooks must never throw.
  }
}

await main();
process.stdout.write('{"continue": true}\n');
