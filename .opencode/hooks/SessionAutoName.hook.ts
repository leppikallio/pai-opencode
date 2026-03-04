#!/usr/bin/env bun

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { readStdinWithTimeout } from "./lib/stdin";
import { paiPath } from "./lib/paths";
import { upsertWorkSessionFromEvent } from "./lib/prd-utils";
import { inference } from "../skills/PAI/Tools/Inference";

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

type JsonRecord = Record<string, unknown>;
type SessionNames = Record<string, string>;

const SESSION_NAMES_PATH = paiPath("MEMORY", "STATE", "session-names.json");

const NAME_PROMPT = `Give this conversation a concise 2-3 word Topic Case title.

Rules:
1. Use exactly 2-3 words.
2. Use only plain English words.
3. Output title text only.`;

const NOISE_WORDS = new Set([
  "about",
  "again",
  "also",
  "build",
  "check",
  "create",
  "does",
  "from",
  "have",
  "just",
  "make",
  "need",
  "please",
  "session",
  "task",
  "that",
  "this",
  "update",
  "with",
]);

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
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

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function sanitizePromptForNaming(prompt: string): string {
  return prompt
    .replace(/<[^>]+>/g, " ")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, " ")
    .replace(/\b[0-9a-f]{7,}\b/gi, " ")
    .replace(/(?:\/[\w.-]+){2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFallbackName(prompt: string): string {
  const words = prompt
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !NOISE_WORDS.has(word.toLowerCase()));

  const topic = words.length > 0 ? words[0] : "General";
  return `${toTitleCase(topic)} Session`;
}

function normalizeGeneratedName(raw: string): string | null {
  const cleaned = raw
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/[.!?,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return null;
  }

  const words = cleaned
    .split(" ")
    .map((word) => word.replace(/[^a-zA-Z]/g, ""))
    .filter(Boolean)
    .slice(0, 3);

  if (words.length < 2 || words.length > 3) {
    return null;
  }

  if (words.some((word) => word.length < 3)) {
    return null;
  }

  return toTitleCase(words.join(" "));
}

function readSessionNames(): SessionNames {
  try {
    if (!existsSync(SESSION_NAMES_PATH)) {
      return {};
    }

    const parsed = JSON.parse(readFileSync(SESSION_NAMES_PATH, "utf8")) as unknown;
    const record = asRecord(parsed);
    if (!record) {
      return {};
    }

    const names: SessionNames = {};
    for (const [sessionId, value] of Object.entries(record)) {
      const label = asString(value);
      if (label) {
        names[sessionId] = label;
      }
    }

    return names;
  } catch {
    return {};
  }
}

function writeSessionNames(names: SessionNames): void {
  const dir = dirname(SESSION_NAMES_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(SESSION_NAMES_PATH, `${JSON.stringify(names, null, 2)}\n`, "utf8");
}

async function upsertPlaceholderWorkSession(sessionId: string, task: string): Promise<void> {
  const result = await upsertWorkSessionFromEvent({
    sessionUUID: sessionId,
    targetKey: `session-${sessionId}`,
    source: "placeholder",
    entry: {
      task,
      phase: "starting",
      mode: "interactive",
      criteria: [],
    },
  });

  if (!result.applied) {
    process.stderr.write(
      `PAI_SESSION_AUTONAME_WORK_JSON_APPLY_SKIPPED:${result.reason ?? "unknown"}\n`,
    );
  }
}

function listSessionIndexFiles(rootDir: string, maxDepth = 3): string[] {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];
  const matches: string[] = [];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      continue;
    }

    let entries: string[];
    try {
      entries = readdirSync(next.dir);
      entries.sort((a, b) => a.localeCompare(b));
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(next.dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isFile() && entry === "sessions-index.json") {
        matches.push(fullPath);
        continue;
      }

      if (stat.isDirectory() && next.depth < maxDepth) {
        queue.push({ dir: fullPath, depth: next.depth + 1 });
      }
    }
  }

  matches.sort((a, b) => a.localeCompare(b));
  return matches;
}

function findCustomTitle(value: unknown, sessionId: string): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCustomTitle(item, sessionId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const thisSessionId = asString(record.sessionId);
  if (thisSessionId === sessionId) {
    const customTitle = asString(record.customTitle);
    if (customTitle) {
      return customTitle;
    }
  }

  for (const nested of Object.values(record)) {
    const found = findCustomTitle(nested, sessionId);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function getCustomTitleFromSessionIndex(sessionId: string): string | undefined {
  const searchRoots = [paiPath("projects"), paiPath("Projects")].sort((a, b) =>
    a.localeCompare(b)
  );

  for (const root of searchRoots) {
    if (!existsSync(root)) {
      continue;
    }

    const indexFiles = listSessionIndexFiles(root).sort((a, b) =>
      a.localeCompare(b)
    );
    for (const filePath of indexFiles) {
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
        const customTitle = findCustomTitle(parsed, sessionId);
        if (customTitle) {
          return customTitle;
        }
      } catch {
        // best effort only
      }
    }
  }

  return undefined;
}

async function generateName(prompt: string): Promise<string> {
  if (process.env.PAI_DISABLE_SESSION_NAMING_INFERENCE === "1") {
    return extractFallbackName(prompt);
  }

  try {
    const result = await inference({
      systemPrompt: NAME_PROMPT,
      userPrompt: prompt.slice(0, 800),
      level: "fast",
      timeout: 10_000,
    });

    if (result.success && result.output) {
      const normalized = normalizeGeneratedName(result.output);
      if (normalized) {
        return normalized;
      }
    }
  } catch {
    // Fallback below
  }

  return extractFallbackName(prompt);
}

async function main(): Promise<void> {
  try {
    const stdin = await readStdinWithTimeout({ timeoutMs: 1500 });
    if (!stdin.trim()) {
      return;
    }

    const payload = asRecord(JSON.parse(stdin));
    if (!payload) {
      return;
    }

    const sessionId = asString(payload.session_id) ?? asString(payload.sessionId);
    if (!sessionId) {
      return;
    }

    const customTitleFromPayload = asString(payload.customTitle);
    const names = readSessionNames();

    if (customTitleFromPayload) {
      if (names[sessionId] !== customTitleFromPayload) {
        names[sessionId] = customTitleFromPayload;
        writeSessionNames(names);
      }
      return;
    }

    if (names[sessionId]) {
      return;
    }

    const customTitleFromIndex = process.env.PAI_SESSION_AUTONAME_SCAN_INDEX === "1"
      ? getCustomTitleFromSessionIndex(sessionId)
      : undefined;
    if (customTitleFromIndex) {
      names[sessionId] = customTitleFromIndex;
      writeSessionNames(names);
      await upsertPlaceholderWorkSession(sessionId, customTitleFromIndex);
      return;
    }

    const rawPrompt = asString(payload.prompt) ?? asString(payload.user_prompt) ?? "";
    const prompt = sanitizePromptForNaming(rawPrompt);
    if (!prompt) {
      return;
    }

    const name = await generateName(prompt);
    names[sessionId] = name;
    writeSessionNames(names);
    await upsertPlaceholderWorkSession(sessionId, name);
  } catch {
    // Hooks must never throw.
  }
}

await main();
process.exit(0);
