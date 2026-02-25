import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

export const REQUIRED_SKILL_RELATIVE_PATH = "skills/PAI/SKILL.md";

export const DEFAULT_CONTEXT_FILES = [
  REQUIRED_SKILL_RELATIVE_PATH,
  "skills/PAI/AISTEERINGRULES.md",
  "skills/PAI/USER/AISTEERINGRULES.md",
] as const;

export type ContextBundle = {
  contextFiles: string[];
  combinedContent: string;
  missingFiles: string[];
  usesConfiguredContextFiles: boolean;
};

type ResolveContextFilesResult = {
  contextFiles: string[];
  usesConfiguredContextFiles: boolean;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function parseSettings(raw: string): JsonRecord {
  try {
    return asRecord(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}

export function loadSettings(paiDir: string): JsonRecord {
  const settingsPath = join(paiDir, "settings.json");
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    return parseSettings(readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

function hasTraversalSegment(pathValue: string): boolean {
  return pathValue.split(/[\\/]+/).some((segment) => segment === "..");
}

function ensureInsidePaiDir(paiDir: string, candidatePath: string, sourcePath: string): void {
  const relativeFromPai = relative(paiDir, candidatePath);
  if (relativeFromPai === "") {
    return;
  }

  if (relativeFromPai.startsWith("..") || isAbsolute(relativeFromPai)) {
    throw new Error(
      `[LoadContext] Invalid settings.json.contextFiles entry (outside runtime root): ${sourcePath}`,
    );
  }
}

function validateConfiguredContextFile(paiDir: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("[LoadContext] Invalid settings.json.contextFiles entry: expected string");
  }

  const relativePath = value.trim();
  if (relativePath.length === 0) {
    throw new Error("[LoadContext] Invalid settings.json.contextFiles entry: empty path");
  }

  if (isAbsolute(relativePath)) {
    throw new Error(
      `[LoadContext] Invalid settings.json.contextFiles entry (absolute path): ${value}`,
    );
  }

  if (hasTraversalSegment(relativePath)) {
    throw new Error(
      `[LoadContext] Invalid settings.json.contextFiles entry (traversal): ${value}`,
    );
  }

  const fullPath = resolve(paiDir, relativePath);
  ensureInsidePaiDir(paiDir, fullPath, value);

  return relativePath;
}

function isSettingsOverride(settings: JsonRecord): boolean {
  return Object.prototype.hasOwnProperty.call(settings, "contextFiles");
}

export function resolveContextFiles(settings: JsonRecord, paiDir: string): ResolveContextFilesResult {
  if (isSettingsOverride(settings)) {
    if (!Array.isArray(settings.contextFiles)) {
      throw new Error("[LoadContext] Invalid settings.json.contextFiles: expected array");
    }

    return {
      contextFiles: settings.contextFiles.map((value) => validateConfiguredContextFile(paiDir, value)),
      usesConfiguredContextFiles: true,
    };
  }

  return {
    contextFiles: [...DEFAULT_CONTEXT_FILES],
    usesConfiguredContextFiles: false,
  };
}

export function hasRequiredSkillFile(paiDir: string): boolean {
  return existsSync(join(paiDir, REQUIRED_SKILL_RELATIVE_PATH));
}

export function loadContextContent(paiDir: string, contextFiles: readonly string[]): ContextBundle {
  const parts: string[] = [];
  const missingFiles: string[] = [];
  const resolvedPaiDir = resolve(paiDir);

  for (const relativePath of contextFiles) {
    const fullPath = resolve(resolvedPaiDir, relativePath);
    ensureInsidePaiDir(resolvedPaiDir, fullPath, relativePath);

    if (!existsSync(fullPath)) {
      missingFiles.push(relativePath);
      continue;
    }

    try {
      parts.push(readFileSync(fullPath, "utf8"));
    } catch {
      missingFiles.push(relativePath);
    }
  }

  return {
    contextFiles: [...contextFiles],
    combinedContent: parts.join("\n\n---\n\n"),
    missingFiles,
    usesConfiguredContextFiles: false,
  };
}

export function loadContextBundle(paiDir: string): ContextBundle {
  const settings = loadSettings(paiDir);
  const { contextFiles, usesConfiguredContextFiles } = resolveContextFiles(settings, paiDir);
  const bundle = loadContextContent(paiDir, contextFiles);
  return {
    ...bundle,
    usesConfiguredContextFiles,
  };
}
