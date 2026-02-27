import * as fs from "node:fs";
import * as path from "node:path";

import { isEnvFlagEnabled, isMemoryParityEnabled } from "../lib/env-flags";
import { getCurrentWorkPathForSession } from "../lib/paths";
import { fileLogError } from "../lib/file-logger";

type UnknownRecord = Record<string, unknown>;

type AgentSpawn = {
  parent_session_id: string;
  child_session_id: string;
  ts: string;
};

type LineageState = {
  v: "0.1";
  updated_at: string;
  tools_used: Record<string, number>;
  files_changed: string[];
  agents_spawned: AgentSpawn[];
};

const LINEAGE_FILENAME = "LINEAGE.json";
const MAX_TRACKED_FILES = 256;
const MAX_TRACKED_TOOLS = 128;
const MAX_TRACKED_AGENTS = 128;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function readString(obj: UnknownRecord, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function defaultLineageState(): LineageState {
  return {
    v: "0.1",
    updated_at: new Date().toISOString(),
    tools_used: {},
    files_changed: [],
    agents_spawned: [],
  };
}

function isTrackingEnabled(): boolean {
  return isMemoryParityEnabled() && isEnvFlagEnabled("PAI_ENABLE_LINEAGE_TRACKING", true);
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

function normalizePathForStorage(filePath: string): string {
  const cleaned = filePath.trim();
  if (!cleaned) return "";
  const normalized = cleaned.replaceAll("\\", "/").replace(/^\.\//, "");
  return path.posix.normalize(normalized);
}

function toWorkspaceRelative(filePath: string): string | undefined {
  const trimmed = filePath.trim();
  if (!trimmed) return undefined;

  if (!path.isAbsolute(trimmed)) {
    const relative = normalizePathForStorage(trimmed);
    return relative && relative !== "." ? relative : undefined;
  }

  const workspace = (process.env.OPENCODE_DIRECTORY ?? "").trim();
  if (!workspace) return undefined;

  const absolute = path.resolve(trimmed);
  const workspaceRoot = path.resolve(workspace);
  const rel = path.relative(workspaceRoot, absolute);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;

  const normalized = normalizePathForStorage(rel);
  return normalized && normalized !== "." ? normalized : undefined;
}

function addUniqueWithCap(values: string[], candidate: string, cap: number): void {
  if (!candidate || values.includes(candidate)) return;
  if (values.length >= cap) return;
  values.push(candidate);
}

function addToolUseWithCap(tools: Record<string, number>, toolName: string): void {
  const existing = tools[toolName];
  if (typeof existing === "number") {
    tools[toolName] = existing + 1;
    return;
  }

  if (Object.keys(tools).length >= MAX_TRACKED_TOOLS) return;
  tools[toolName] = 1;
}

function extractApplyPatchFiles(toolArgs: unknown): string[] {
  if (!isRecord(toolArgs)) return [];
  const patchText = readString(toolArgs, "patchText") ?? readString(toolArgs, "patch");
  if (!patchText) return [];

  const files: string[] = [];
  const headerRegex = /^\*\*\*\s+(Add|Update|Delete)\s+File:\s+(.+)$/gm;
  while (true) {
    const match = headerRegex.exec(patchText);
    if (!match) break;
    const rawPath = (match[2] ?? "").trim();
    if (!rawPath) continue;
    const withoutQuotes = rawPath.replace(/^(["'])(.+)\1$/, "$2");
    const normalized = normalizePathForStorage(withoutQuotes);
    if (!normalized || normalized === ".") continue;
    addUniqueWithCap(files, normalized, MAX_TRACKED_FILES);
  }
  return files;
}

function extractChangedFiles(toolName: string, toolArgs: unknown): string[] {
  if (toolName === "apply_patch") {
    return extractApplyPatchFiles(toolArgs);
  }

  if (toolName === "write" || toolName === "edit") {
    if (!isRecord(toolArgs)) return [];
    const filePath = readString(toolArgs, "filePath");
    if (!filePath) return [];
    const relative = toWorkspaceRelative(filePath);
    return relative ? [relative] : [];
  }

  return [];
}

async function readLineage(lineagePath: string): Promise<LineageState> {
  try {
    const content = await fs.promises.readFile(lineagePath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) return defaultLineageState();

    const toolsUsed = isRecord(parsed.tools_used) ? parsed.tools_used : {};
    const filesChanged = Array.isArray(parsed.files_changed) ? parsed.files_changed : [];
    const agentsSpawned = Array.isArray(parsed.agents_spawned) ? parsed.agents_spawned : [];

    const normalizedTools: Record<string, number> = {};
    for (const [key, value] of Object.entries(toolsUsed)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
      const normalizedKey = normalizeToolName(key);
      if (!normalizedKey) continue;
      if (!(normalizedKey in normalizedTools) && Object.keys(normalizedTools).length >= MAX_TRACKED_TOOLS) {
        continue;
      }
      normalizedTools[normalizedKey] = value;
    }

    const normalizedFiles: string[] = [];
    for (const filePath of filesChanged) {
      if (typeof filePath !== "string") continue;
      const normalized = normalizePathForStorage(filePath);
      if (!normalized || normalized === ".") continue;
      addUniqueWithCap(normalizedFiles, normalized, MAX_TRACKED_FILES);
    }

    const normalizedAgents: AgentSpawn[] = [];
    const seen = new Set<string>();
    for (const item of agentsSpawned) {
      if (!isRecord(item)) continue;
      const parentSessionId = readString(item, "parent_session_id") ?? "";
      const childSessionId = readString(item, "child_session_id") ?? "";
      const ts = readString(item, "ts") ?? new Date().toISOString();
      if (!parentSessionId || !childSessionId) continue;
      const key = `${parentSessionId}:${childSessionId}`;
      if (seen.has(key)) continue;
      if (normalizedAgents.length >= MAX_TRACKED_AGENTS) break;
      seen.add(key);
      normalizedAgents.push({
        parent_session_id: parentSessionId,
        child_session_id: childSessionId,
        ts,
      });
    }

    return {
      v: "0.1",
      updated_at: readString(parsed, "updated_at") ?? new Date().toISOString(),
      tools_used: normalizedTools,
      files_changed: normalizedFiles,
      agents_spawned: normalizedAgents,
    };
  } catch {
    return defaultLineageState();
  }
}

async function writeLineageAtomic(lineagePath: string, state: LineageState): Promise<void> {
  const tempPath = `${lineagePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = `${JSON.stringify(state, null, 2)}\n`;

  try {
    await fs.promises.writeFile(tempPath, payload, "utf8");
    await fs.promises.rename(tempPath, lineagePath);
  } finally {
    try {
      await fs.promises.unlink(tempPath);
    } catch {
      // best effort
    }
  }
}

export async function recordToolUse(sessionId: string, toolNameRaw: string, toolArgs: unknown): Promise<void> {
  if (!isTrackingEnabled()) return;
  const toolName = normalizeToolName(toolNameRaw);
  if (!toolName) return;

  try {
    const workPath = await getCurrentWorkPathForSession(sessionId);
    if (!workPath) return;

    const lineagePath = path.join(workPath, LINEAGE_FILENAME);
    const lineage = await readLineage(lineagePath);

    addToolUseWithCap(lineage.tools_used, toolName);
    const changedFiles = extractChangedFiles(toolName, toolArgs);
    for (const filePath of changedFiles) {
      addUniqueWithCap(lineage.files_changed, filePath, MAX_TRACKED_FILES);
    }

    lineage.updated_at = new Date().toISOString();
    await writeLineageAtomic(lineagePath, lineage);
  } catch (error) {
    fileLogError("Lineage tracker tool recording failed", error);
  }
}

export async function recordAgentSpawn(parentSessionId: string, childSessionId: string): Promise<void> {
  if (!isTrackingEnabled()) return;
  if (!parentSessionId || !childSessionId) return;

  try {
    const workPath = await getCurrentWorkPathForSession(parentSessionId);
    if (!workPath) return;

    const lineagePath = path.join(workPath, LINEAGE_FILENAME);
    const lineage = await readLineage(lineagePath);
    const key = `${parentSessionId}:${childSessionId}`;
    const exists = lineage.agents_spawned.some(
      (entry) => `${entry.parent_session_id}:${entry.child_session_id}` === key,
    );
    if (!exists && lineage.agents_spawned.length < MAX_TRACKED_AGENTS) {
      lineage.agents_spawned.push({
        parent_session_id: parentSessionId,
        child_session_id: childSessionId,
        ts: new Date().toISOString(),
      });
    }

    lineage.updated_at = new Date().toISOString();
    await writeLineageAtomic(lineagePath, lineage);
  } catch (error) {
    fileLogError("Lineage tracker agent spawn recording failed", error);
  }
}
