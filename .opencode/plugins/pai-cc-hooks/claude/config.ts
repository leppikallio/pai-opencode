import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

export function getClaudeSettingsPaths(customPath?: string): string[] {
  const opencodeRoot = getOpencodeRoot();
  const paths = [join(opencodeRoot, "settings.json")];

  if (customPath && existsSync(customPath) && basename(customPath) === "settings.json") {
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
  // Prefer OpenCode-native runtime root env vars.
  // This keeps all hook/plugin state global (typically ~/.config/opencode) and
  // prevents accidental writes into the current project directory.
  const configuredRuntimeRoot = (env.OPENCODE_ROOT ?? env.OPENCODE_CONFIG_ROOT)?.trim();
  const hasPlaceholder = typeof configuredRuntimeRoot === "string" && configuredRuntimeRoot.includes("${");
  if (!configuredRuntimeRoot || hasPlaceholder) {
    env = {
      ...env,
      OPENCODE_ROOT: opencodeRoot,
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

  const requestedPath =
    customSettingsPath && basename(customSettingsPath) === "settings.json" ? customSettingsPath : undefined;

  const settingsPath = requestedPath ?? opencodeSettingsPath;
  const settings = await readRawSettings(settingsPath);

  const hooks = settings?.hooks ? normalizeHooksConfig(settings.hooks) : {};
  const env = normalizeEnvConfig(settings?.env);
  return finalizeLoadedSettings(hooks, env, opencodeRoot);
}

export type { ClaudeHooksConfig } from "./types";
