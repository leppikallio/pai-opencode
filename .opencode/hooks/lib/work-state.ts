import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { getPaiDir } from "./paths";
import { getPSTComponents } from "./time";

export interface CurrentWorkState {
  session_id: string;
  session_dir: string;
  current_task: string;
  task_title: string;
  task_count: number;
  created_at: string;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_SESSION_ID_LENGTH = 128;

function isInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  if (relativePath === "") {
    return true;
  }

  return !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function resolveInsidePaiDir(...parts: string[]): string | null {
  const paiDir = resolve(getPaiDir());
  const candidatePath = resolve(paiDir, ...parts);
  return isInsideRoot(paiDir, candidatePath) ? candidatePath : null;
}

function stateDirPath(): string | null {
  return resolveInsidePaiDir("MEMORY", "STATE");
}

export function normalizeSessionId(sessionId: string): string | null {
  const trimmed = sessionId.trim();
  if (!trimmed || trimmed.length > MAX_SESSION_ID_LENGTH) {
    return null;
  }

  return SESSION_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function currentWorkStatePath(sessionId: string): string | null {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  return resolveInsidePaiDir("MEMORY", "STATE", `current-work-${normalizedSessionId}.json`);
}

function asCurrentWorkState(value: unknown): CurrentWorkState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.session_id !== "string" ||
    typeof record.session_dir !== "string" ||
    typeof record.current_task !== "string" ||
    typeof record.task_title !== "string" ||
    typeof record.task_count !== "number" ||
    typeof record.created_at !== "string"
  ) {
    return null;
  }

  return {
    session_id: record.session_id,
    session_dir: record.session_dir,
    current_task: record.current_task,
    task_title: record.task_title,
    task_count: record.task_count,
    created_at: record.created_at,
  };
}

export function readCurrentWorkState(sessionId: string): CurrentWorkState | null {
  const statePath = currentWorkStatePath(sessionId);
  if (!statePath || !existsSync(statePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as unknown;
    return asCurrentWorkState(parsed);
  } catch {
    return null;
  }
}

export function writeCurrentWorkState(state: CurrentWorkState): void {
  const sessionId = normalizeSessionId(state.session_id);
  const dir = stateDirPath();
  if (!sessionId || !dir) {
    return;
  }

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const statePath = currentWorkStatePath(sessionId);
  if (!statePath) {
    return;
  }

  writeFileSync(
    statePath,
    `${JSON.stringify({ ...state, session_id: sessionId }, null, 2)}\n`,
    "utf8",
  );
}

export function clearCurrentWorkState(sessionId: string): void {
  const statePath = currentWorkStatePath(sessionId);
  if (!statePath || !existsSync(statePath)) {
    return;
  }

  try {
    unlinkSync(statePath);
  } catch {
    // Hooks must never throw.
  }
}

export function slugify(value: string, maxLength = 40): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/-$/g, "");

  return slug || "task";
}

export function sessionDirName(title: string, date: Date = new Date()): string {
  const parts = getPSTComponents(date);
  const timestamp = `${parts.year}${parts.month}${parts.day}-${parts.hours}${parts.minutes}${parts.seconds}`;
  return `${timestamp}_${slugify(title, 50)}`;
}

export function taskDirName(taskNumber: number, title: string): string {
  const taskId = String(taskNumber).padStart(3, "0");
  return `${taskId}_${slugify(title, 40)}`;
}
