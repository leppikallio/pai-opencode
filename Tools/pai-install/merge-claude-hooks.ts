import fs from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

export type MergeClaudeHooksSeedIntoSettingsJsonArgs = {
  targetDir: string;
  sourceSeedPath: string;
};

export type MergeClaudeHooksSeedIntoSettingsJsonResult = {
  settingsPath: string;
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

function readJsonObjectRequired(filePath: string, label: string): JsonRecord {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    throw new Error(`${label} file is empty: ${filePath}`);
  }

  return parseJsonObject(raw, filePath);
}

function rewriteHookCommandPlaceholders(value: unknown, targetDir: string): unknown {
  const normalizedTargetDir = targetDir.replace(/\\/g, "/");
  const paiDirPrefix = "$" + "{PAI_DIR}/";

  if (Array.isArray(value)) {
    return value.map((item) => rewriteHookCommandPlaceholders(item, normalizedTargetDir));
  }

  if (isPlainObject(value)) {
    const rewritten: JsonRecord = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "command" && typeof entry === "string") {
        rewritten[key] = entry.split(paiDirPrefix).join(`${normalizedTargetDir}/`);
        continue;
      }
      rewritten[key] = rewriteHookCommandPlaceholders(entry, normalizedTargetDir);
    }
    return rewritten;
  }

  return value;
}

function mergeEnv(runtimeEnv: unknown, seedEnv: unknown, targetDir: string): JsonRecord {
  const runtime = isPlainObject(runtimeEnv) ? runtimeEnv : {};
  const seed = isPlainObject(seedEnv) ? seedEnv : {};

  return {
    ...runtime,
    ...seed,
    PAI_DIR: targetDir,
  };
}

function mergeHooks(runtimeHooks: unknown, seedHooks: unknown, targetDir: string): JsonRecord {
  // Repo seed is the source of truth for hooks.
  // Install must be able to REMOVE hooks that were deleted from the seed.
  if (seedHooks === undefined) {
    return isPlainObject(runtimeHooks)
      ? (rewriteHookCommandPlaceholders(runtimeHooks, targetDir) as JsonRecord)
      : {};
  }

  if (!isPlainObject(seedHooks)) {
    throw new Error("Expected hooks to be a JSON object in settings seed");
  }

  return rewriteHookCommandPlaceholders(seedHooks, targetDir) as JsonRecord;
}

const REQUIRED_PAI_CONTEXT_FILES = [
  "skills/PAI/SYSTEM/AISTEERINGRULES.md",
  "skills/PAI/USER/AISTEERINGRULES.md",
  "skills/PAI/USER/DAIDENTITY.md",
] as const;

const LEGACY_PAI_SKILL_CONTEXT_FILE = "skills/PAI/SKILL.md";
const LEGACY_PAI_SKILL_CONTEXT_FILE_KEY = "skills/pai/skill.md";

function parseContextFiles(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  if (!value.every((entry): entry is string => typeof entry === "string")) {
    return null;
  }

  return value;
}

function normalizeContextFileKey(entry: string): string {
  return entry.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function pruneLegacyPaiSkillContextFile(
  contextFiles: string[] | null,
  sourceLabel: string,
): string[] | null {
  if (!contextFiles) {
    return contextFiles;
  }

  let removedCount = 0;
  const pruned = contextFiles.filter((entry) => {
    const isLegacyEntry =
      normalizeContextFileKey(entry).toLowerCase() === LEGACY_PAI_SKILL_CONTEXT_FILE_KEY;
    if (isLegacyEntry) {
      removedCount += 1;
    }
    return !isLegacyEntry;
  });

  if (removedCount > 0) {
    console.error(
      `[pai-install] Pruned ${removedCount} deprecated contextFiles entry from ${sourceLabel}: ${LEGACY_PAI_SKILL_CONTEXT_FILE}`,
    );
  }

  return pruned;
}

function mergeContextFiles(runtimeContextFiles: unknown, seedContextFiles: unknown): unknown {
  const seed = pruneLegacyPaiSkillContextFile(parseContextFiles(seedContextFiles), "seed settings.json");
  const runtime = pruneLegacyPaiSkillContextFile(
    parseContextFiles(runtimeContextFiles),
    "runtime settings.json",
  );
  const runtimeMissing = runtimeContextFiles === undefined || runtimeContextFiles === null;
  const runtimeEmptyAfterPrune = Array.isArray(runtime) && runtime.length === 0;

  if (runtimeMissing || runtimeEmptyAfterPrune) {
    return seed ? [...seed] : runtimeContextFiles;
  }

  if (!runtime) {
    return runtimeContextFiles;
  }

  const hasCoreEntries = runtime.some((entry) =>
    normalizeContextFileKey(entry).toLowerCase().startsWith("skills/core/"),
  );

  if (!hasCoreEntries) {
    return [...runtime];
  }

  const seen = new Set<string>();
  const repaired: string[] = [];

  for (const entry of runtime) {
    const normalizedKey = normalizeContextFileKey(entry);
    if (normalizedKey.toLowerCase().startsWith("skills/core/")) {
      continue;
    }

    if (seen.has(normalizedKey)) {
      continue;
    }

    seen.add(normalizedKey);
    repaired.push(entry);
  }

  for (const entry of REQUIRED_PAI_CONTEXT_FILES) {
    const normalizedKey = normalizeContextFileKey(entry);
    if (seen.has(normalizedKey)) {
      continue;
    }

    seen.add(normalizedKey);
    repaired.push(entry);
  }

  return repaired;
}

export function mergeClaudeHooksSeedIntoSettingsJson(
  args: MergeClaudeHooksSeedIntoSettingsJsonArgs,
): MergeClaudeHooksSeedIntoSettingsJsonResult {
  const settingsPath = path.join(args.targetDir, "settings.json");
  const backupsDir = path.join(args.targetDir, "BACKUPS");
  const backupPath = path.join(backupsDir, `settings.json.${Date.now()}.bak`);

  const settings = readJsonObjectOrEmpty(settingsPath);
  const seed = readJsonObjectRequired(args.sourceSeedPath, "Claude hooks seed");

  const merged: JsonRecord = {
    ...settings,
    contextFiles: mergeContextFiles(settings.contextFiles, seed.contextFiles),
    env: mergeEnv(settings.env, seed.env, args.targetDir),
    hooks: mergeHooks(settings.hooks, seed.hooks, args.targetDir),
  };

  const currentContent = `${JSON.stringify(settings, null, 2)}\n`;
  const nextContent = `${JSON.stringify(merged, null, 2)}\n`;
  const changed = currentContent !== nextContent;
  let writtenBackupPath: string | null = null;

  if (changed) {
    fs.mkdirSync(backupsDir, { recursive: true });
    if (fs.existsSync(settingsPath)) {
      fs.copyFileSync(settingsPath, backupPath);
      writtenBackupPath = backupPath;
    }
    fs.writeFileSync(settingsPath, nextContent, "utf8");
  }

  return {
    settingsPath,
    backupPath: writtenBackupPath,
    changed,
  };
}
