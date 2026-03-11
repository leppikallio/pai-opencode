import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

export type MergeOpencodeInstructionsArgs = {
  targetDir: string;
  supportsRtkRewrite: boolean;
};

export type MergeOpencodeInstructionsResult = {
  opencodeConfigPath: string;
  backupPath: string | null;
  changed: boolean;
};

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw: string, filePath: string): JsonRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON at ${filePath}: ${reason}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`Expected JSON object at ${filePath}`);
  }

  return parsed;
}

function readJsonObjectOrEmpty(filePath: string): JsonRecord {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return {};
  }

  return parseJsonObject(raw, filePath);
}

function expandTildePath(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

// Keep this identity model aligned with prompt-control canonicalSourcePathKey().
function canonicalSourcePathKey(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return "";
  }

  const expanded = expandTildePath(trimmed);
  const withNativeSeparators = expanded.replace(/[\\/]+/g, path.sep);
  const resolved = path.resolve(withNativeSeparators);
  return resolved.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function normalizeInstructionEntry(entry: unknown): string | null {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!isPlainObject(entry)) {
    return null;
  }

  const candidatePath = entry.path;
  if (typeof candidatePath !== "string") {
    return null;
  }

  const trimmed = candidatePath.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildOwnedRtkPathKeys(targetDir: string): Set<string> {
  const canonicalRuntimeRtkPath = path.resolve(path.join(targetDir, "RTK.md"));
  const legacyRuntimeRtkPath = path.join(os.homedir(), ".config", "opencode", "RTK.md");
  return new Set([
    canonicalSourcePathKey(canonicalRuntimeRtkPath),
    canonicalSourcePathKey(legacyRuntimeRtkPath),
  ]);
}

function isOwnedRtkInstructionPath(pathValue: string, ownedPathKeys: Set<string>): boolean {
  const normalized = canonicalSourcePathKey(pathValue);
  return normalized.length > 0 && ownedPathKeys.has(normalized);
}

export function mergeOpencodeInstructions(
  args: MergeOpencodeInstructionsArgs,
): MergeOpencodeInstructionsResult {
  const opencodeConfigPath = path.join(args.targetDir, "opencode.json");
  const backupsDir = path.join(args.targetDir, "BACKUPS");
  const backupPath = path.join(backupsDir, `opencode.json.${Date.now()}.bak`);

  const existingConfig = readJsonObjectOrEmpty(opencodeConfigPath);
  const existingInstructionsRaw = Array.isArray(existingConfig.instructions)
    ? existingConfig.instructions
    : [];

  const existingInstructionStrings = existingInstructionsRaw
    .map((entry) => normalizeInstructionEntry(entry))
    .filter((entry): entry is string => entry !== null);

  const ownedRtkPathKeys = buildOwnedRtkPathKeys(args.targetDir);

  const preservedInstructions = existingInstructionStrings.filter(
    (entry) => !isOwnedRtkInstructionPath(entry, ownedRtkPathKeys),
  );

  const canonicalRuntimeRtkPath = path.resolve(path.join(args.targetDir, "RTK.md"));
  const mergedInstructions = args.supportsRtkRewrite
    ? [...preservedInstructions, canonicalRuntimeRtkPath]
    : [...preservedInstructions];

  const mergedConfig: JsonRecord = {
    ...existingConfig,
    instructions: mergedInstructions,
  };

  const currentContent = `${JSON.stringify(existingConfig, null, 2)}\n`;
  const nextContent = `${JSON.stringify(mergedConfig, null, 2)}\n`;
  const changed = currentContent !== nextContent;

  let writtenBackupPath: string | null = null;
  if (changed) {
    fs.mkdirSync(path.dirname(opencodeConfigPath), { recursive: true });
    if (fs.existsSync(opencodeConfigPath)) {
      fs.mkdirSync(backupsDir, { recursive: true });
      fs.copyFileSync(opencodeConfigPath, backupPath);
      writtenBackupPath = backupPath;
    }
    fs.writeFileSync(opencodeConfigPath, nextContent, "utf8");
  }

  return {
    opencodeConfigPath,
    backupPath: writtenBackupPath,
    changed,
  };
}
