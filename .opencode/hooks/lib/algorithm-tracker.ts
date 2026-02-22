import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface AlgorithmTrackerState {
  sessionId: string;
  updatedAt: string;
  criteria: unknown[];
  agentSpawns: Array<{
    at: string;
    agentType?: string;
    description?: string;
  }>;
  lastBashCommand?: string;
}

interface TrackerPayload {
  session_id?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
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

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolvePaiDir(paiDir?: string): string {
  const resolved = paiDir?.trim() || process.env.PAI_DIR?.trim();
  if (!resolved || resolved.includes("${PAI_DIR}")) {
    return process.cwd();
  }
  return resolved;
}

function statePathForSession(paiDir: string, sessionId: string): string {
  return join(paiDir, ...TRACKER_STATE_DIR_PARTS, `${sessionId}.json`);
}

function sanitizeExistingState(
  sessionId: string,
  updatedAt: string,
  existing: Record<string, unknown> | null,
): AlgorithmTrackerState {
  const criteria = asArray(existing?.criteria);
  const existingAgentSpawns = asArray(existing?.agentSpawns);
  const agentSpawns: AlgorithmTrackerState["agentSpawns"] = [];

  for (const entry of existingAgentSpawns) {
    const record = asRecord(entry);
    if (!record) continue;

    const at = asNonEmptyString(record.at);
    if (!at) continue;

    const agentType = asNonEmptyString(record.agentType);
    const description = asNonEmptyString(record.description);

    agentSpawns.push({
      at,
      ...(agentType ? { agentType } : {}),
      ...(description ? { description } : {}),
    });
  }

  return {
    sessionId,
    updatedAt,
    criteria: cloneJsonValue(criteria),
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

  if (toolName !== "TodoWrite" && toolName !== "Task" && toolName !== "Bash") {
    return { updated: false, reason: "unsupported_tool" };
  }

  const nowIso = (options?.now ?? new Date()).toISOString();
  const paiDir = resolvePaiDir(options?.paiDir);
  const statePath = statePathForSession(paiDir, sessionId);
  const existing = await readExistingState(statePath);
  const state = sanitizeExistingState(sessionId, nowIso, existing);
  const toolInput = asRecord(payloadRecord.tool_input);

  if (toolName === "TodoWrite") {
    state.criteria = cloneJsonValue(asArray(toolInput?.todos));
  }

  if (toolName === "Task") {
    state.agentSpawns.push({
      at: nowIso,
      agentType: asNonEmptyString(toolInput?.subagent_type) ?? asNonEmptyString(toolInput?.agent_type),
      description: asNonEmptyString(toolInput?.description),
    });
  }

  if (toolName === "Bash") {
    state.lastBashCommand = asNonEmptyString(toolInput?.command);
  }

  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  return {
    updated: true,
    statePath,
    state,
  };
}
