import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaudeHooksConfig, HookCommand, HookMatcher } from "./types";

interface RawHookMatcher {
  matcher?: string;
  pattern?: string;
  hooks: HookCommand[];
}

interface RawClaudeHooksConfig {
  PreToolUse?: RawHookMatcher[];
  PostToolUse?: RawHookMatcher[];
  UserPromptSubmit?: RawHookMatcher[];
  SessionStart?: RawHookMatcher[];
  SessionEnd?: RawHookMatcher[];
  Stop?: RawHookMatcher[];
  PreCompact?: RawHookMatcher[];
}

interface RawClaudeSettings {
  hooks?: RawClaudeHooksConfig;
  env?: Record<string, unknown>;
}

export interface LoadedClaudeHookSettings {
  hooks: ClaudeHooksConfig | null;
  env: Record<string, string>;
}

function normalizeHookMatcher(raw: RawHookMatcher): HookMatcher {
  return {
    matcher: raw.matcher ?? raw.pattern ?? "*",
    hooks: Array.isArray(raw.hooks) ? raw.hooks : [],
  };
}

function normalizeHooksConfig(raw: RawClaudeHooksConfig): ClaudeHooksConfig {
  const result: ClaudeHooksConfig = {};
  const eventTypes: (keyof RawClaudeHooksConfig)[] = [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "SessionStart",
    "SessionEnd",
    "Stop",
    "PreCompact",
  ];

  for (const eventType of eventTypes) {
    const value = raw[eventType];
    if (value) {
      result[eventType] = value.map(normalizeHookMatcher);
    }
  }

  return result;
}

function normalizeEnvConfig(raw: Record<string, unknown> | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      normalized[key] = value;
    }
  }

  return normalized;
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUsableSettingsPayload(settings: RawClaudeSettings): boolean {
  const hasHooks = isNonArrayObject(settings.hooks) && Object.keys(settings.hooks).length > 0;
  const hasEnv = isNonArrayObject(settings.env) && Object.keys(settings.env).length > 0;
  return hasHooks || hasEnv;
}

export function getClaudeSettingsPaths(customPath?: string): string[] {
  const opencodeRoot = getOpencodeRoot();
  const paths = [
    join(opencodeRoot, "settings.json"),
    join(opencodeRoot, "config", "claude-hooks.settings.json"),
    join(process.cwd(), ".claude", "settings.json"),
    join(process.cwd(), ".claude", "settings.local.json"),
    join(homedir(), ".claude", "settings.json"),
  ];

  if (customPath && existsSync(customPath)) {
    paths.push(customPath);
  }

  return [...new Set(paths)];
}

function getOpencodeRoot(): string {
  const pluginDir = dirname(fileURLToPath(import.meta.url));
  const fileDerivedRoot = resolve(pluginDir, "..", "..", "..");

  const overrideRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;
  if (!overrideRoot) {
    return fileDerivedRoot;
  }

  const normalizedRoot = resolve(overrideRoot);
  return basename(normalizedRoot) === "config" ? dirname(normalizedRoot) : normalizedRoot;
}

function logParseFailure(settingsPath: string, error: unknown): void {
  if (process.env.PAI_CC_HOOKS_DEBUG !== "1") {
    return;
  }

  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`[pai-cc-hooks] Failed to parse JSON in ${settingsPath}: ${reason}`);
}

function mergeHooksConfig(base: ClaudeHooksConfig, override: ClaudeHooksConfig): ClaudeHooksConfig {
  const result: ClaudeHooksConfig = { ...base };
  const eventTypes: (keyof ClaudeHooksConfig)[] = [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "SessionStart",
    "SessionEnd",
    "Stop",
    "PreCompact",
  ];
  for (const eventType of eventTypes) {
    if (override[eventType]) {
      result[eventType] = [...(base[eventType] || []), ...override[eventType]];
    }
  }
  return result;
}

export async function loadClaudeHooksConfig(customSettingsPath?: string): Promise<ClaudeHooksConfig | null> {
  const settings = await loadClaudeHookSettings(customSettingsPath);
  return settings.hooks;
}

async function readRawSettings(settingsPath: string): Promise<RawClaudeSettings | null> {
  if (!existsSync(settingsPath)) {
    return null;
  }

  try {
    const content = await readFile(settingsPath, "utf-8");
    try {
      return JSON.parse(content) as RawClaudeSettings;
    } catch (error) {
      logParseFailure(settingsPath, error);
      return null;
    }
  } catch {
    return null;
  }
}

function finalizeLoadedSettings(
  hooks: ClaudeHooksConfig,
  env: Record<string, string>,
  opencodeRoot: string,
): LoadedClaudeHookSettings {
  const configuredPaiDir = env.PAI_DIR?.trim();
  const paiDirPlaceholder = "$" + "{PAI_DIR}";
  const hasPlaceholderPaiDir = typeof configuredPaiDir === "string" && configuredPaiDir.includes(paiDirPlaceholder);
  if (!configuredPaiDir || hasPlaceholderPaiDir) {
    env = {
      ...env,
      PAI_DIR: opencodeRoot,
    };
  }

  return {
    hooks: Object.keys(hooks).length > 0 ? hooks : null,
    env,
  };
}

export async function loadClaudeHookSettings(customSettingsPath?: string): Promise<LoadedClaudeHookSettings> {
  const opencodeRoot = getOpencodeRoot();
  const opencodeSettingsPath = join(opencodeRoot, "settings.json");

  if (customSettingsPath) {
    const customSettings = await readRawSettings(customSettingsPath);
    if (customSettings && hasUsableSettingsPayload(customSettings)) {
      const hooks = customSettings.hooks ? normalizeHooksConfig(customSettings.hooks) : {};
      const env = normalizeEnvConfig(customSettings.env);
      return finalizeLoadedSettings(hooks, env, opencodeRoot);
    }
  }

  const opencodeSettings = await readRawSettings(opencodeSettingsPath);
  if (opencodeSettings && hasUsableSettingsPayload(opencodeSettings)) {
    const hooks = opencodeSettings.hooks ? normalizeHooksConfig(opencodeSettings.hooks) : {};
    const env = normalizeEnvConfig(opencodeSettings.env);
    return finalizeLoadedSettings(hooks, env, opencodeRoot);
  }

  const fallbackPaths = getClaudeSettingsPaths(customSettingsPath).filter((settingsPath) => settingsPath !== opencodeSettingsPath);
  let mergedConfig: ClaudeHooksConfig = {};
  let mergedEnv: Record<string, string> = {};

  for (const settingsPath of fallbackPaths) {
    const settings = await readRawSettings(settingsPath);
    if (!settings) {
      continue;
    }

    if (settings.hooks) {
      const normalizedHooks = normalizeHooksConfig(settings.hooks);
      mergedConfig = mergeHooksConfig(mergedConfig, normalizedHooks);
    }

    mergedEnv = {
      ...mergedEnv,
      ...normalizeEnvConfig(settings.env),
    };
  }

  return finalizeLoadedSettings(mergedConfig, mergedEnv, opencodeRoot);
}

export type { ClaudeHooksConfig } from "./types";
