import fs from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

export type MergeSeedHooksIntoRuntimeSettingsArgs = {
  targetDir: string;
  sourceSeedPath: string;
  dryRun?: boolean;
};

export type MergeSeedHooksIntoRuntimeSettingsResult = {
  settingsPath: string;
  backupPath: string;
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

function readJsonObject(filePath: string): JsonRecord {
  if (!fs.existsSync(filePath)) {
    throw new Error(`JSON file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return parseJsonObject(raw, filePath);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    const body = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",");
    return `{${body}}`;
  }

  return JSON.stringify(value);
}

function dedupeEntries<T>(entries: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const entry of entries) {
    const key = stableStringify(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }

  return result;
}

function rewriteHookCommandPlaceholders(value: unknown, targetDir: string): unknown {
  const normalizedTargetDir = targetDir.replace(/\\/g, "/");
  const paiDirPrefix = "$" + "{PAI_DIR}/";

  if (Array.isArray(value)) {
    return value.map((item) => rewriteHookCommandPlaceholders(item, normalizedTargetDir));
  }

  if (isPlainObject(value)) {
    const rewritten: JsonRecord = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "command" && typeof item === "string") {
        rewritten[key] = item.replaceAll(paiDirPrefix, `${normalizedTargetDir}/`);
        continue;
      }
      rewritten[key] = rewriteHookCommandPlaceholders(item, normalizedTargetDir);
    }
    return rewritten;
  }

  return value;
}

function mergeHooks(runtimeHooks: unknown, seedHooks: unknown, targetDir: string): JsonRecord {
  const runtime = isPlainObject(runtimeHooks)
    ? (rewriteHookCommandPlaceholders(runtimeHooks, targetDir) as JsonRecord)
    : {};
  const seed = isPlainObject(seedHooks) ? (rewriteHookCommandPlaceholders(seedHooks, targetDir) as JsonRecord) : {};

  const merged: JsonRecord = {};
  const keys = new Set([...Object.keys(runtime), ...Object.keys(seed)]);

  for (const key of keys) {
    const runtimeValue = runtime[key];
    const seedValue = seed[key];

    if (Array.isArray(runtimeValue) || Array.isArray(seedValue)) {
      const runtimeEntries = Array.isArray(runtimeValue) ? runtimeValue : [];
      const seedEntries = Array.isArray(seedValue) ? seedValue : [];
      merged[key] = dedupeEntries([...runtimeEntries, ...seedEntries]);
      continue;
    }

    if (seedValue !== undefined) {
      merged[key] = seedValue;
      continue;
    }

    if (runtimeValue !== undefined) {
      merged[key] = runtimeValue;
    }
  }

  return merged;
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

export function mergeSeedHooksIntoRuntimeSettings(
  args: MergeSeedHooksIntoRuntimeSettingsArgs,
): MergeSeedHooksIntoRuntimeSettingsResult {
  const { targetDir, sourceSeedPath, dryRun = false } = args;
  const settingsPath = path.join(targetDir, "settings.json");
  const backupsDir = path.join(targetDir, "BACKUPS");
  const backupPath = path.join(backupsDir, `settings.json.${Date.now()}.bak`);

  const runtimeSettings = readJsonObject(settingsPath);
  const seedSettings = readJsonObject(sourceSeedPath);

  const merged: JsonRecord = {
    ...runtimeSettings,
    env: mergeEnv(runtimeSettings.env, seedSettings.env, targetDir),
    hooks: mergeHooks(runtimeSettings.hooks, seedSettings.hooks, targetDir),
  };

  const currentContent = `${JSON.stringify(runtimeSettings, null, 2)}\n`;
  const nextContent = `${JSON.stringify(merged, null, 2)}\n`;
  const changed = currentContent !== nextContent;

  if (!dryRun && changed) {
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.copyFileSync(settingsPath, backupPath);
    fs.writeFileSync(settingsPath, nextContent, "utf8");
  }

  return {
    settingsPath,
    backupPath,
    changed,
  };
}
