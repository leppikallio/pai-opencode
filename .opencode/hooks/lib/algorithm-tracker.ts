import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import crypto from "node:crypto";

import { getPaiDir } from "./paths";

export interface AlgorithmTrackerState {
  sessionId: string;
  updatedAt: string;
  currentPhase?: string;
  effortLevel?: string;
  criteria: Array<{
    id: string;
    description: string;
    status: string;
    priority?: string;
  }>;
  agentSpawns: Array<{
    at: string;
    name?: string;
    agentType?: string;
    description?: string;
  }>;
  lastBashCommand?: string;
}

interface TrackerPayload {
  session_id?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
  tool_response?: unknown;
}

interface UpdateOptions {
  paiDir?: string;
  now?: Date;
}

interface UpdateResult {
  updated: boolean;
  reason?: string;
  statePath?: string;
  state?: AlgorithmTrackerState;
}

const TRACKER_STATE_DIR_PARTS = ["MEMORY", "STATE", "algorithm-tracker"] as const;
const GLOBAL_STATE_PATH_PARTS = ["MEMORY", "STATE", "algorithm-state.json"] as const;

const PHASE_MAP: Record<string, string> = {
  "entering the observe phase": "OBSERVE",
  "entering the think phase": "THINK",
  "entering the plan phase": "PLAN",
  "entering the build phase": "BUILD",
  "entering the execute phase": "EXECUTE",
  "entering the verify phase": "VERIFY",
  "entering the learn phase": "LEARN",
  "entering the verify phase.": "VERIFY",
};

const ALGORITHM_ENTRY = "entering the pai algorithm";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stableIdFromText(text: string): string {
  const hash = crypto.createHash("sha1").update(text).digest("hex");
  return `T${hash.slice(0, 10)}`;
}

function parseCriterionFromTodoContent(content: string): { id: string; description: string } {
  const trimmed = content.trim();
  const m1 = trimmed.match(/^ISC-([^:]+):\s*(.+)$/);
  if (m1) return { id: m1[1].trim(), description: m1[2].trim() };
  const m2 = trimmed.match(/^([AC]\d+):\s*(.+)$/);
  if (m2) return { id: m2[1].trim(), description: m2[2].trim() };
  return { id: stableIdFromText(trimmed), description: trimmed };
}

function inferEffortLevel(criteriaCount: number): string | null {
  if (criteriaCount >= 40) return "DEEP";
  if (criteriaCount >= 20) return "ADVANCED";
  if (criteriaCount >= 12) return "EXTENDED";
  return null;
}

function upgradeEffortLevel(current: string | undefined, inferred: string | null): string | undefined {
  if (!inferred) return current;
  const normalized = (current ?? "DETERMINED").toUpperCase();
  if (normalized === "DETERMINED" || normalized === "STANDARD") return inferred;
  return current;
}

function detectPhaseFromText(message: string): { phase: string | null; isAlgorithmEntry: boolean } {
  const lower = message.toLowerCase();
  if (lower.includes(ALGORITHM_ENTRY)) return { phase: null, isAlgorithmEntry: true };
  for (const [pattern, phase] of Object.entries(PHASE_MAP)) {
    if (lower.includes(pattern)) return { phase, isAlgorithmEntry: false };
  }
  return { phase: null, isAlgorithmEntry: false };
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolvePaiDir(paiDir?: string): string {
  const fromOptions = paiDir?.trim();
  if (fromOptions && !fromOptions.includes("${")) {
    return resolve(fromOptions);
  }

  return getPaiDir();
}

function statePathForSession(paiDir: string, sessionId: string): string {
  return join(paiDir, ...TRACKER_STATE_DIR_PARTS, `${sessionId}.json`);
}

function sanitizeExistingState(
  sessionId: string,
  updatedAt: string,
  existing: Record<string, unknown> | null,
): AlgorithmTrackerState {
  const criteriaRaw = asArray(existing?.criteria);
  const existingAgentSpawns = asArray(existing?.agentSpawns);
  const agentSpawns: AlgorithmTrackerState["agentSpawns"] = [];

  for (const entry of existingAgentSpawns) {
    const record = asRecord(entry);
    if (!record) continue;

    const at = asNonEmptyString(record.at);
    if (!at) continue;

    const name = asNonEmptyString(record.name);
    const agentType = asNonEmptyString(record.agentType);
    const description = asNonEmptyString(record.description);

    agentSpawns.push({
      at,
      ...(name ? { name } : {}),
      ...(agentType ? { agentType } : {}),
      ...(description ? { description } : {}),
    });
  }

  const criteria: AlgorithmTrackerState["criteria"] = [];
  for (const entry of criteriaRaw) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = asNonEmptyString(record.id);
    const description = asNonEmptyString(record.description);
    const status = asNonEmptyString(record.status) ?? "pending";
    const priority = asNonEmptyString(record.priority);
    if (!id || !description) continue;
    criteria.push({
      id,
      description,
      status,
      ...(priority ? { priority } : {}),
    });
  }

  return {
    sessionId,
    updatedAt,
    currentPhase: asNonEmptyString(existing?.currentPhase),
    effortLevel: asNonEmptyString(existing?.effortLevel),
    criteria,
    agentSpawns,
    lastBashCommand: asNonEmptyString(existing?.lastBashCommand),
  };
}

async function readExistingState(statePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

export async function updateAlgorithmTrackerState(payload: unknown, options?: UpdateOptions): Promise<UpdateResult> {
  const payloadRecord = asRecord(payload) as TrackerPayload | null;
  if (!payloadRecord) {
    return { updated: false, reason: "payload_not_object" };
  }

  const sessionId = asNonEmptyString(payloadRecord.session_id);
  if (!sessionId) {
    return { updated: false, reason: "missing_session_id" };
  }

  const toolName = asNonEmptyString(payloadRecord.tool_name);
  if (!toolName) {
    return { updated: false, reason: "missing_tool_name" };
  }

  if (toolName !== "TodoWrite" && toolName !== "Task" && toolName !== "Bash" && toolName !== "VoiceNotify") {
    return { updated: false, reason: "unsupported_tool" };
  }

  const nowIso = (options?.now ?? new Date()).toISOString();
  const paiDir = resolvePaiDir(options?.paiDir);
  const statePath = statePathForSession(paiDir, sessionId);
  const existing = await readExistingState(statePath);
  const state = sanitizeExistingState(sessionId, nowIso, existing);
  const toolInput = asRecord(payloadRecord.tool_input);
  const toolResponse = asRecord(payloadRecord.tool_response);

  if (toolName === "TodoWrite") {
    const todos = asArray(toolInput?.todos ?? toolResponse?.todos);
    const criteria: AlgorithmTrackerState["criteria"] = [];
    for (const entry of todos) {
      const record = asRecord(entry);
      if (!record) continue;
      const content = asNonEmptyString(record.content);
      if (!content) continue;

      const parsed = parseCriterionFromTodoContent(content);
      const status = asNonEmptyString(record.status) ?? "pending";
      const priority = asNonEmptyString(record.priority);
      criteria.push({
        id: parsed.id,
        description: parsed.description,
        status,
        ...(priority ? { priority } : {}),
      });
    }

    const inferred = inferEffortLevel(criteria.length);
    state.criteria = criteria;
    state.effortLevel = upgradeEffortLevel(state.effortLevel, inferred);
  }

  if (toolName === "Task") {
    state.agentSpawns.push({
      at: nowIso,
      name: asNonEmptyString(toolInput?.name) ?? asNonEmptyString(toolInput?.description),
      agentType: asNonEmptyString(toolInput?.subagent_type) ?? asNonEmptyString(toolInput?.agent_type),
      description: asNonEmptyString(toolInput?.description),
    });
  }

  if (toolName === "Bash") {
    state.lastBashCommand = asNonEmptyString(toolInput?.command);

    // Optional phase tracking from legacy curl-to-voice-server usage.
    const cmd = state.lastBashCommand;
    if (cmd && cmd.includes("localhost:8888") && cmd.includes("/notify")) {
      const messageMatch = cmd.match(/"message"\s*:\s*"([^"]+)"/);
      if (messageMatch) {
        const { phase, isAlgorithmEntry } = detectPhaseFromText(messageMatch[1]);
        if (isAlgorithmEntry && !state.currentPhase) state.currentPhase = "OBSERVE";
        if (phase) state.currentPhase = phase;
      }
    }
  }

  if (toolName === "VoiceNotify") {
    const message = asNonEmptyString(toolInput?.message);
    if (message) {
      const { phase, isAlgorithmEntry } = detectPhaseFromText(message);
      if (isAlgorithmEntry && !state.currentPhase) state.currentPhase = "OBSERVE";
      if (phase) state.currentPhase = phase;
    }
  }

  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  // Also maintain a single global projection for UI/status checks.
  // This is intentionally a lossy projection (latest session wins).
  const globalStatePath = join(paiDir, ...GLOBAL_STATE_PATH_PARTS);
  const existingGlobal = await readExistingState(globalStatePath);
  const globalRecord = existingGlobal ?? {};
  globalRecord.sessionId = sessionId;
  globalRecord.lastUpdatedAt = nowIso;
  globalRecord.currentPhase = state.currentPhase ?? globalRecord.currentPhase ?? "OBSERVE";
  globalRecord.effortLevel = state.effortLevel ?? globalRecord.effortLevel ?? "DETERMINED";
  globalRecord.criteria = cloneJsonValue(state.criteria);
  globalRecord.agentSpawns = cloneJsonValue(state.agentSpawns);
  globalRecord.lastBashCommand = state.lastBashCommand;
  if (!globalRecord.startTime) globalRecord.startTime = nowIso;
  if (!globalRecord.lastPhaseChange) globalRecord.lastPhaseChange = nowIso;
  if (!globalRecord.iteration) globalRecord.iteration = 1;
  await mkdir(dirname(globalStatePath), { recursive: true });
  await writeFile(globalStatePath, `${JSON.stringify(globalRecord, null, 2)}\n`, "utf8");

  return {
    updated: true,
    statePath,
    state,
  };
}
