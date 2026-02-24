#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { paiPath } from "./lib/paths";
import { readStdinWithTimeout } from "./lib/stdin";
import { getPSTComponents } from "./lib/time";
import { readCurrentWorkState } from "./lib/work-state";

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

type HookInput = {
  session_id?: string;
};

type MetaSnapshot = {
  title: string;
  source: string | null;
  status: string | null;
  created_at: string | null;
  completed_at: string | null;
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

function resolveWorkSessionPath(sessionDir: string): string | null {
  const trimmed = sessionDir.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const workRoot = realpathSync(resolve(paiPath("MEMORY", "WORK")));
    const sessionPath = resolve(workRoot, trimmed);
    const sessionRealPath = realpathSync(sessionPath);
    const relativePath = relative(workRoot, sessionRealPath);
    if (relativePath !== "" && (relativePath.startsWith("..") || isAbsolute(relativePath))) {
      return null;
    }

    return sessionRealPath;
  } catch {
    return null;
  }
}

function parseYamlScalar(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") {
    return null;
  }

  const quoted = /^("|')([\s\S]*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

function parseMetaYaml(content: string): MetaSnapshot {
  const snapshot: MetaSnapshot = {
    title: "Work Session",
    source: null,
    status: null,
    created_at: null,
    completed_at: null,
  };

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const value = parseYamlScalar(rawValue);
    if (value === null) {
      continue;
    }

    if (key === "title") {
      snapshot.title = value;
    } else if (key === "source") {
      snapshot.source = value;
    } else if (key === "status") {
      snapshot.status = value;
    } else if (key === "created_at") {
      snapshot.created_at = value;
    } else if (key === "completed_at") {
      snapshot.completed_at = value;
    }
  }

  return snapshot;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function formatIscSummary(iscPath: string): string {
  if (!existsSync(iscPath)) {
    return "No ISC snapshot available.";
  }

  try {
    const parsed = JSON.parse(readFileSync(iscPath, "utf8")) as unknown;
    const root = asRecord(parsed);
    if (!root) {
      return "No ISC snapshot available.";
    }

    const current = asRecord(root.current) ?? root;
    const criteria = asStringArray(current.criteria);
    const antiCriteria = asStringArray(current.antiCriteria);

    const lines: string[] = [];
    if (criteria.length > 0) {
      lines.push("### Criteria");
      lines.push(...criteria.map((criterion) => `- ${criterion}`));
      lines.push("");
    }

    if (antiCriteria.length > 0) {
      lines.push("### Anti-Criteria");
      lines.push(...antiCriteria.map((criterion) => `- ${criterion}`));
      lines.push("");
    }

    const satisfaction = asRecord(root.satisfaction);
    if (satisfaction) {
      const satisfied = typeof satisfaction.satisfied === "number" ? satisfaction.satisfied : 0;
      const total = typeof satisfaction.total === "number" ? satisfaction.total : 0;
      const partial = typeof satisfaction.partial === "number" ? satisfaction.partial : 0;
      const failed = typeof satisfaction.failed === "number" ? satisfaction.failed : 0;
      lines.push(`### Satisfaction`);
      lines.push(`- Satisfied: ${satisfied}/${total}`);
      lines.push(`- Partial: ${partial}`);
      lines.push(`- Failed: ${failed}`);
      lines.push("");
    }

    return lines.length > 0 ? lines.join("\n").trim() : "No ISC snapshot available.";
  } catch {
    return "No ISC snapshot available.";
  }
}

function readIscCriteriaCount(iscPath: string): number {
  if (!existsSync(iscPath)) {
    return 0;
  }

  try {
    const parsed = JSON.parse(readFileSync(iscPath, "utf8")) as unknown;
    const root = asRecord(parsed);
    if (!root) {
      return 0;
    }

    const current = asRecord(root.current) ?? root;
    return asStringArray(current.criteria).length;
  } catch {
    return 0;
  }
}

function learningCategory(meta: MetaSnapshot, taskTitle: string): "SYSTEM" | "ALGORITHM" {
  const source = meta.source?.trim().toUpperCase();
  if (source === "SYSTEM" || source === "ALGORITHM") {
    return source;
  }

  const candidate = `${meta.title} ${taskTitle}`.toLowerCase();
  return candidate.includes("algorithm") ? "ALGORITHM" : "SYSTEM";
}

function monthToken(now: Date = new Date()): string {
  const parts = getPSTComponents(now);
  return `${parts.year}-${parts.month}`;
}

function timestampToken(now: Date = new Date()): string {
  const parts = getPSTComponents(now);
  return `${parts.year}${parts.month}${parts.day}-${parts.hours}${parts.minutes}${parts.seconds}`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/g, "");

  return slug || "work-session";
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function threadContainsAlgorithmMarkers(threadContent: string): boolean {
  const markers = ["PAI ALGORITHM", "OBSERVE", "THINK", "PLAN", "BUILD", "EXECUTE", "VERIFY", "LEARN"];
  return markers.some((marker) => threadContent.includes(marker));
}

function isSignificantWorkSession(sessionPath: string, iscPath: string): boolean {
  if (readIscCriteriaCount(iscPath) > 0) {
    return true;
  }

  const threadPath = join(sessionPath, "THREAD.md");
  if (!existsSync(threadPath)) {
    return false;
  }

  try {
    const thread = readFileSync(threadPath, "utf8");
    const significantThreadLength = 500;
    return thread.length >= significantThreadLength || threadContainsAlgorithmMarkers(thread);
  } catch {
    return false;
  }
}

function isEexistError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

function renderLearningMarkdown(args: {
  title: string;
  category: "SYSTEM" | "ALGORITHM";
  sessionId: string;
  sessionDir: string;
  status: string;
  createdAt: string;
  completedAt: string;
  iscSummary: string;
}): string {
  return [
    "# Work Completion Learning",
    "",
    `- Title: ${args.title}`,
    `- Category: ${args.category}`,
    `- Session ID: ${args.sessionId}`,
    `- Session Dir: ${args.sessionDir}`,
    `- Status: ${args.status}`,
    `- Created At: ${args.createdAt}`,
    `- Completed At: ${args.completedAt}`,
    "",
    "## ISC Snapshot",
    "",
    args.iscSummary,
    "",
    "_Captured by WorkCompletionLearning hook._",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  try {
    const rawInput = await readStdinWithTimeout({ timeoutMs: 2000 });
    const input = parseHookInput(rawInput);
    if (!input.session_id) {
      return;
    }

    const state = readCurrentWorkState(input.session_id);
    if (!state) {
      return;
    }

    const sessionPath = resolveWorkSessionPath(state.session_dir);
    if (!sessionPath) {
      return;
    }

    const metaPath = join(sessionPath, "META.yaml");
    if (!existsSync(metaPath)) {
      return;
    }

    const meta = parseMetaYaml(readFileSync(metaPath, "utf8"));
    const iscPath = join(sessionPath, "ISC.json");
    if (!isSignificantWorkSession(sessionPath, iscPath)) {
      return;
    }

    const category = learningCategory(meta, state.task_title);
    const learningDate = parseIsoDate(meta.completed_at) ?? parseIsoDate(meta.created_at) ?? parseIsoDate(state.created_at) ?? new Date();
    const monthDir = paiPath("MEMORY", "LEARNING", category, monthToken(learningDate));
    mkdirSync(monthDir, { recursive: true });

    const title = meta.title || state.task_title || "Work Session";
    const baseName = `${timestampToken(learningDate)}_session_${slugify(state.session_id)}`;
    const learningPath = join(monthDir, `${baseName}.md`);

    const content = renderLearningMarkdown({
      title,
      category,
      sessionId: state.session_id,
      sessionDir: state.session_dir,
      status: meta.status ?? "UNKNOWN",
      createdAt: meta.created_at ?? state.created_at,
      completedAt: meta.completed_at ?? "null",
      iscSummary: formatIscSummary(iscPath),
    });

    try {
      writeFileSync(learningPath, content, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (isEexistError(error)) {
        return;
      }

      throw error;
    }
  } catch {
    // Hooks must never throw.
  }
}

await main();
process.exit(0);
