#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";

import { paiPath } from "./lib/paths";
import {
  buildWorkEntryFromParsedPrd,
  deriveSessionUUIDFromPrdPath,
  parsePrdFile,
  scanCanonicalPrdInSessionDir,
  upsertWorkSessionFromEvent,
} from "./lib/prd-utils";

type WorkStateSessionEntry = {
  sessionUUID?: string;
  source?: string;
  prdPath?: string;
};

type WorkStateSnapshot = {
  sessions: Record<string, WorkStateSessionEntry>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readWorkStateSnapshot(workPath: string): WorkStateSnapshot | null {
  let raw = "";
  try {
    raw = fs.readFileSync(workPath, "utf8");
  } catch {
    return null;
  }

  if (!raw.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsedRecord = asRecord(parsed);
  if (!parsedRecord) {
    return null;
  }

  const sessionsRecord = asRecord(parsedRecord.sessions) ?? {};
  const sessions: Record<string, WorkStateSessionEntry> = {};

  for (const [targetKey, value] of Object.entries(sessionsRecord)) {
    const record = asRecord(value);
    if (!record) {
      continue;
    }

    sessions[targetKey] = {
      sessionUUID: asString(record.sessionUUID),
      source: asString(record.source),
      prdPath: asString(record.prdPath),
    };
  }

  return { sessions };
}

async function listSessionDirs(memoryWorkRoot: string): Promise<string[]> {
  let monthEntries: fs.Dirent[] = [];
  try {
    monthEntries = await fs.promises.readdir(memoryWorkRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessionDirs: string[] = [];
  const sortedMonthEntries = [...monthEntries].sort((a, b) => a.name.localeCompare(b.name));

  for (const monthEntry of sortedMonthEntries) {
    if (!monthEntry.isDirectory()) {
      continue;
    }

    const monthPath = path.join(memoryWorkRoot, monthEntry.name);
    let sessionEntries: fs.Dirent[] = [];
    try {
      sessionEntries = await fs.promises.readdir(monthPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const sortedSessionEntries = [...sessionEntries].sort((a, b) => a.name.localeCompare(b.name));
    for (const sessionEntry of sortedSessionEntries) {
      if (!sessionEntry.isDirectory()) {
        continue;
      }

      sessionDirs.push(path.join(monthPath, sessionEntry.name));
    }
  }

  return sessionDirs;
}

function shouldSkipUpsert(args: {
  snapshot: WorkStateSnapshot | null;
  sessionUUID: string;
  targetKey: string;
  canonicalPrdPath: string;
}): boolean {
  if (!args.snapshot) {
    return false;
  }

  const matchingEntries = Object.entries(args.snapshot.sessions).filter(
    ([, entry]) => entry.sessionUUID === args.sessionUUID,
  );
  if (matchingEntries.length !== 1) {
    return false;
  }

  const [existingTargetKey, existingEntry] = matchingEntries[0] ?? [];
  if (!existingTargetKey || existingTargetKey !== args.targetKey) {
    return false;
  }

  if (existingEntry?.source !== "prd") {
    return false;
  }

  const existingPrdPath = asString(existingEntry.prdPath);
  if (!existingPrdPath) {
    return false;
  }

  return path.resolve(existingPrdPath) === path.resolve(args.canonicalPrdPath);
}

async function main(): Promise<void> {
  const paiDir = paiPath();
  const memoryWorkRoot = paiPath("MEMORY", "WORK");
  const workJsonPath = paiPath("MEMORY", "STATE", "work.json");

  const snapshot = readWorkStateSnapshot(workJsonPath);
  const sessionDirs = await listSessionDirs(memoryWorkRoot);
  if (sessionDirs.length === 0) {
    return;
  }

  let indexedSessions = 0;
  let unchangedSessions = 0;

  for (const sessionDir of sessionDirs) {
    const canonicalPrdPath = await scanCanonicalPrdInSessionDir(sessionDir);
    if (!canonicalPrdPath) {
      continue;
    }

    const sessionUUID = deriveSessionUUIDFromPrdPath(paiDir, canonicalPrdPath);
    if (!sessionUUID) {
      continue;
    }

    const parsedPrd = await parsePrdFile(canonicalPrdPath);
    if (!parsedPrd) {
      continue;
    }

    const builtEntry = buildWorkEntryFromParsedPrd({
      sessionUUID,
      prdPath: canonicalPrdPath,
      parsedPrd,
    });

    if (
      shouldSkipUpsert({
        snapshot,
        sessionUUID,
        targetKey: builtEntry.targetKey,
        canonicalPrdPath,
      })
    ) {
      unchangedSessions += 1;
      continue;
    }

    const result = await upsertWorkSessionFromEvent({
      sessionUUID,
      targetKey: builtEntry.targetKey,
      source: "prd",
      entry: builtEntry.entry,
    });

    if (!result.applied) {
      process.stderr.write(
        `[warn] WorkJsonBackfill skipped session ${sessionUUID}: ${result.reason ?? "unknown"}\n`,
      );
      continue;
    }

    indexedSessions += 1;
  }

  process.stdout.write(
    `[write] work.json backfill indexed=${indexedSessions} unchanged=${unchangedSessions}\n`,
  );
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[WorkJsonBackfill] ${message}\n`);
  process.exit(1);
}

process.exit(0);
