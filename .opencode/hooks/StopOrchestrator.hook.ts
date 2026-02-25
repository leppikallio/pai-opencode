#!/usr/bin/env bun

import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

import {
  parseTranscript,
  type ParsedTranscript,
} from "../skills/PAI/Tools/TranscriptParser";

import { handleAlgorithmEnrichment } from "./handlers/AlgorithmEnrichment";
import { handleDocCrossRefIntegrity } from "./handlers/DocCrossRefIntegrity";
import { handleRebuildSkill } from "./handlers/RebuildSkill";
import { handleTabState } from "./handlers/TabState";
import { getPaiDir } from "./lib/paths";
import { readStdinWithTimeout } from "./lib/stdin";

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  hook_event_name?: string;
}

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
      transcript_path: asString(parsed.transcript_path),
      hook_event_name: asString(parsed.hook_event_name),
    };
  } catch {
    return {};
  }
}

function waitForFlush(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function resolveTranscriptPath(transcriptPath: string | undefined): string | null {
  if (!transcriptPath) {
    return null;
  }

  const trimmed = transcriptPath.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const realPaiDir = realpathSync(resolve(getPaiDir()));
    const realTranscriptPath = realpathSync(resolve(trimmed));
    const paiPrefix = realPaiDir.endsWith(sep) ? realPaiDir : `${realPaiDir}${sep}`;
    if (!realTranscriptPath.startsWith(paiPrefix)) {
      return null;
    }

    if (!realTranscriptPath.endsWith(".jsonl")) {
      return null;
    }

    return realTranscriptPath;
  } catch {
    return null;
  }
}

async function runHandlers(parsed: ParsedTranscript, hookInput: HookInput): Promise<void> {
  const sessionId = hookInput.session_id ?? "unknown-session";
  const handlers: Array<Promise<void>> = [
    handleTabState(parsed, sessionId),
    handleRebuildSkill(),
    handleAlgorithmEnrichment(parsed, sessionId),
    handleDocCrossRefIntegrity(parsed, hookInput),
  ];

  const handlerNames = [
    "TabState",
    "RebuildSkill",
    "AlgorithmEnrichment",
    "DocCrossRefIntegrity",
  ];

  const results = await Promise.allSettled(handlers);
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`[StopOrchestrator] ${handlerNames[index]} handler failed:`, result.reason);
    }
  });
}

async function main(): Promise<void> {
  const rawInput = await readStdinWithTimeout({ timeoutMs: 1_000 });
  const hookInput = parseHookInput(rawInput);

  const transcriptPath = resolveTranscriptPath(hookInput.transcript_path);
  if (!transcriptPath) {
    return;
  }

  await waitForFlush(150);
  const parsed = parseTranscript(transcriptPath);
  await runHandlers(parsed, hookInput);
}

try {
  await main();
} catch (error) {
  console.error("[StopOrchestrator] Fatal error:", error);
} finally {
  process.exit(0);
}
