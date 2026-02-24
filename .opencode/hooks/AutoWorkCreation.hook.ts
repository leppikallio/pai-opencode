#!/usr/bin/env bun

import {
  existsSync,
  lstatSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { paiPath } from "./lib/paths";
import { readStdinWithTimeout } from "./lib/stdin";
import { getISOTimestamp } from "./lib/time";
import {
  readCurrentWorkState,
  normalizeSessionId,
  sessionDirName,
  taskDirName,
  writeCurrentWorkState,
} from "./lib/work-state";

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

type HookInput = {
  session_id?: string;
  prompt?: string;
  user_prompt?: string;
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
      prompt: asString(parsed.prompt),
      user_prompt: asString(parsed.user_prompt),
    };
  } catch {
    return {};
  }
}

function promptTitle(prompt: string): string {
  const normalized = prompt
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "Work Session";
  }

  return normalized.slice(0, 80).trim();
}

function createSessionMeta(args: {
  sessionDir: string;
  title: string;
  sessionId: string;
  timestamp: string;
}): string {
  return [
    `id: ${JSON.stringify(args.sessionDir)}`,
    `title: ${JSON.stringify(args.title)}`,
    `session_id: ${JSON.stringify(args.sessionId)}`,
    `created_at: ${JSON.stringify(args.timestamp)}`,
    "completed_at: null",
    'status: "ACTIVE"',
    "",
  ].join("\n");
}

function createThreadMarkdown(args: { title: string; prompt: string }): string {
  return [
    `# Algorithm Thread: ${args.title}`,
    "",
    "## Prompt",
    "",
    args.prompt,
    "",
    "## Notes",
    "",
    "- Pending.",
    "",
  ].join("\n");
}

function ensureCurrentTaskLink(currentTaskLink: string, taskName: string): void {
  try {
    const existing = lstatSync(currentTaskLink);
    if (existing.isDirectory() && !existing.isSymbolicLink()) {
      process.stderr.write(
        `[AutoWorkCreation] Refusing to replace directory at tasks/current: ${currentTaskLink}\n`,
      );
      return;
    }

    unlinkSync(currentTaskLink);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && code !== "ENOENT") {
      return;
    }
  }

  symlinkSync(taskName, currentTaskLink);
}

function createInitialWorkStructure(sessionId: string, prompt: string): void {
  if (readCurrentWorkState(sessionId)) {
    return;
  }

  const title = promptTitle(prompt);
  const sessionDir = sessionDirName(title);
  const taskName = taskDirName(1, title);
  const createdAt = getISOTimestamp();

  const sessionPath = paiPath("MEMORY", "WORK", sessionDir);
  const tasksPath = join(sessionPath, "tasks");
  const taskPath = join(tasksPath, taskName);
  const currentTaskLink = join(tasksPath, "current");

  mkdirSync(taskPath, { recursive: true });
  mkdirSync(join(sessionPath, "scratch"), { recursive: true });

  writeFileSync(
    join(sessionPath, "META.yaml"),
    createSessionMeta({
      sessionDir,
      title,
      sessionId,
      timestamp: createdAt,
    }),
    "utf8",
  );

  writeFileSync(
    join(taskPath, "ISC.json"),
    `${JSON.stringify({
      taskId: taskName,
      status: "PENDING",
      criteria: [],
      antiCriteria: [],
      createdAt,
      updatedAt: createdAt,
    }, null, 2)}\n`,
    "utf8",
  );

  writeFileSync(
    join(taskPath, "THREAD.md"),
    createThreadMarkdown({ title, prompt }),
    "utf8",
  );

  ensureCurrentTaskLink(currentTaskLink, taskName);

  writeCurrentWorkState({
    session_id: sessionId,
    session_dir: sessionDir,
    current_task: taskName,
    task_title: title,
    task_count: 1,
    created_at: createdAt,
  });
}

async function main(): Promise<void> {
  try {
    const rawInput = await readStdinWithTimeout({ timeoutMs: 2000 });
    const input = parseHookInput(rawInput);
    const sessionId = normalizeSessionId(input.session_id ?? "");
    const prompt = input.prompt ?? input.user_prompt;

    if (!sessionId || !prompt) {
      return;
    }

    const workRoot = paiPath("MEMORY", "WORK");
    if (!existsSync(workRoot)) {
      mkdirSync(workRoot, { recursive: true });
    }

    createInitialWorkStructure(sessionId, prompt);
  } catch {
    // Hooks must never throw.
  }
}

await main();
process.exit(0);
