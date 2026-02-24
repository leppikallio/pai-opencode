#!/usr/bin/env bun

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { paiPath } from "./lib/paths";
import { readStdinWithTimeout } from "./lib/stdin";
import { getISOTimestamp } from "./lib/time";
import {
  clearCurrentWorkState,
  readCurrentWorkState,
} from "./lib/work-state";

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

function setYamlField(content: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}:.*$`, "m");
  const line = `${key}: ${value}`;

  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }

  const suffix = content.endsWith("\n") ? "" : "\n";
  return `${content}${suffix}${line}\n`;
}

function resolveWorkSessionPath(sessionDir: string): string | null {
  const trimmed = sessionDir.trim();
  if (!trimmed) {
    return null;
  }

  const workRoot = resolve(paiPath("MEMORY", "WORK"));
  const sessionPath = resolve(workRoot, trimmed);
  const relativePath = relative(workRoot, sessionPath);
  if (relativePath !== "" && (relativePath.startsWith("..") || isAbsolute(relativePath))) {
    return null;
  }

  return sessionPath;
}

function markSessionComplete(sessionPath: string): void {
  const metaPath = join(sessionPath, "META.yaml");
  if (!existsSync(metaPath)) {
    return;
  }

  const completedAt = getISOTimestamp();
  const original = readFileSync(metaPath, "utf8");
  let updated = setYamlField(original, "status", '"COMPLETED"');
  updated = setYamlField(updated, "completed_at", JSON.stringify(completedAt));

  if (!updated.endsWith("\n")) {
    updated = `${updated}\n`;
  }

  writeFileSync(metaPath, updated, "utf8");
}

async function main(): Promise<void> {
  try {
    const rawInput = await readStdinWithTimeout({ timeoutMs: 2000 });
    const input = parseHookInput(rawInput);
    const sessionId = input.session_id;
    if (!sessionId) {
      return;
    }

    const state = readCurrentWorkState(sessionId);
    if (!state) {
      return;
    }

    const sessionPath = resolveWorkSessionPath(state.session_dir);
    if (!sessionPath) {
      return;
    }

    markSessionComplete(sessionPath);
    clearCurrentWorkState(sessionId);
  } catch {
    // Hooks must never throw.
  }
}

await main();
process.exit(0);
