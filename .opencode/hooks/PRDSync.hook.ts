#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import path from "node:path";

import { getPaiDir } from "./lib/paths";
import {
  buildWorkEntryFromParsedPrd,
  deriveSessionDirFromPrdPath,
  deriveSessionUUIDFromPrdPath,
  extractApplyPatchPaths,
  isPrdPathUnderMemoryWork,
  parsePrdFile,
  removeWorkSessionEntries,
  resolveApplyPatchPaths,
  scanCanonicalPrdInSessionDir,
  type PathAction,
  upsertWorkSessionFromEvent,
} from "./lib/prd-utils";
import { setPhaseTab } from "./lib/tab-state";

type JsonRecord = Record<string, unknown>;

type ChangedPath = {
  action: PathAction;
  absolutePath: string;
};

type SessionChangeBucket = {
  sessionDirs: Set<string>;
  changes: ChangedPath[];
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStdinBestEffort(): unknown {
  try {
    const raw = readFileSync(0, "utf8").trim();
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function getSessionUUIDFromPayload(payload: JsonRecord): string | undefined {
  return asString(payload.session_id) ?? asString(payload.sessionId);
}

function collectDirectToolInputPaths(toolInput: JsonRecord): Array<{ action: PathAction; filePathRaw: string }> {
  const out: Array<{ action: PathAction; filePathRaw: string }> = [];
  const directPathFields = ["file_path", "filePath", "path"] as const;
  for (const field of directPathFields) {
    const filePath = asString(toolInput[field]);
    if (filePath) {
      out.push({ action: "write", filePathRaw: filePath });
    }
  }

  const patchTextRaw = asString(toolInput.patch_text) ?? asString(toolInput.patchText);
  if (patchTextRaw) {
    for (const item of extractApplyPatchPaths(patchTextRaw)) {
      out.push({ action: item.action, filePathRaw: item.filePath });
    }
  }

  return out;
}

function resolveChangedPaths(args: {
  paiDir: string;
  cwd?: string;
  toolInput: JsonRecord;
}): ChangedPath[] {
  const resolved: ChangedPath[] = [];

  for (const item of collectDirectToolInputPaths(args.toolInput)) {
    const candidates = resolveApplyPatchPaths({
      paiDir: args.paiDir,
      cwd: args.cwd,
      filePathRaw: item.filePathRaw,
    });

    for (const candidate of candidates) {
      resolved.push({
        action: item.action,
        absolutePath: path.resolve(candidate),
      });
    }
  }

  const deduped = new Map<string, ChangedPath>();
  for (const item of resolved) {
    deduped.set(`${item.action}:${item.absolutePath}`, item);
  }

  return Array.from(deduped.values());
}

async function applyPrdToWorkJson(args: {
  sessionUUID: string;
  prdPath: string;
  payloadSessionUUID?: string;
}): Promise<void> {
  const parsedPrd = await parsePrdFile(args.prdPath);
  if (!parsedPrd) {
    return;
  }

  const entry = buildWorkEntryFromParsedPrd({
    sessionUUID: args.sessionUUID,
    prdPath: args.prdPath,
    parsedPrd,
  });

  const upserted = await upsertWorkSessionFromEvent({
    sessionUUID: args.sessionUUID,
    targetKey: entry.targetKey,
    entry: entry.entry,
    source: "prd",
  });

  if (!upserted.applied) {
    if (upserted.reason) {
      process.stderr.write(`PAI_PRDSYNC_WORK_JSON_APPLY_SKIPPED:${upserted.reason}\n`);
    }
    return;
  }

  if (!upserted.phaseChanged || !upserted.phase) {
    return;
  }

  if (!args.payloadSessionUUID || args.payloadSessionUUID !== args.sessionUUID) {
    return;
  }

  await setPhaseTab(upserted.phase, args.payloadSessionUUID);
}

async function processSessionBucket(args: {
  sessionUUID: string;
  bucket: SessionChangeBucket;
  payloadSessionUUID?: string;
}): Promise<void> {
  const writePaths = Array.from(
    new Set(
      args.bucket.changes
        .filter((change) => change.action === "write")
        .map((change) => change.absolutePath)
        .sort(),
    ),
  );

  const shouldRescan = args.bucket.changes.some((change) => change.action === "delete");
  if (!shouldRescan) {
    for (const writePath of writePaths) {
      await applyPrdToWorkJson({
        sessionUUID: args.sessionUUID,
        prdPath: writePath,
        payloadSessionUUID: args.payloadSessionUUID,
      });

      const parsed = await parsePrdFile(writePath);
      if (parsed) {
        return;
      }
    }
  }

  const sessionDirCandidates = Array.from(args.bucket.sessionDirs).sort();
  for (const sessionDir of sessionDirCandidates) {
    const canonicalPrd = await scanCanonicalPrdInSessionDir(sessionDir);
    if (!canonicalPrd) {
      continue;
    }

    await applyPrdToWorkJson({
      sessionUUID: args.sessionUUID,
      prdPath: canonicalPrd,
      payloadSessionUUID: args.payloadSessionUUID,
    });

    const parsed = await parsePrdFile(canonicalPrd);
    if (parsed) {
      return;
    }
  }

  await removeWorkSessionEntries(args.sessionUUID);
}

process.stdout.write('{"continue": true}\n');

try {
  const payload = asRecord(readStdinBestEffort());
  if (!payload) {
    process.exit(0);
  }

  const toolInput = asRecord(payload.tool_input);
  if (!toolInput) {
    process.exit(0);
  }

  const paiDir = getPaiDir();
  const payloadSessionUUID = getSessionUUIDFromPayload(payload);
  const cwd = asString(payload.cwd);

  const changedPaths = resolveChangedPaths({ paiDir, cwd, toolInput });
  if (changedPaths.length === 0) {
    process.exit(0);
  }

  const buckets = new Map<string, SessionChangeBucket>();
  for (const change of changedPaths) {
    if (!isPrdPathUnderMemoryWork(paiDir, change.absolutePath)) {
      continue;
    }

    const sessionUUID = deriveSessionUUIDFromPrdPath(paiDir, change.absolutePath);
    if (!sessionUUID) {
      continue;
    }

    const sessionDir = deriveSessionDirFromPrdPath(paiDir, change.absolutePath);
    const existingBucket = buckets.get(sessionUUID) ?? {
      sessionDirs: new Set<string>(),
      changes: [],
    };

    existingBucket.changes.push(change);
    if (sessionDir) {
      existingBucket.sessionDirs.add(sessionDir);
    }

    buckets.set(sessionUUID, existingBucket);
  }

  for (const [sessionUUID, bucket] of buckets) {
    await processSessionBucket({
      sessionUUID,
      bucket,
      payloadSessionUUID,
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[PRDSync] ${message}\n`);
}

process.exit(0);
