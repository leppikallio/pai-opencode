import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getClaudeConfigDir } from "../shared/claude-config-dir";
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
  Stop?: RawHookMatcher[];
  PreCompact?: RawHookMatcher[];
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

export function getClaudeSettingsPaths(customPath?: string): string[] {
  const claudeConfigDir = getClaudeConfigDir();
  const paths = [
    join(claudeConfigDir, "settings.json"),
    join(process.cwd(), ".claude", "settings.json"),
    join(process.cwd(), ".claude", "settings.local.json"),
  ];

  if (customPath && existsSync(customPath)) {
    paths.unshift(customPath);
  }

  return [...new Set(paths)];
}

function mergeHooksConfig(base: ClaudeHooksConfig, override: ClaudeHooksConfig): ClaudeHooksConfig {
  const result: ClaudeHooksConfig = { ...base };
  const eventTypes: (keyof ClaudeHooksConfig)[] = [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
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
  const paths = getClaudeSettingsPaths(customSettingsPath);
  let mergedConfig: ClaudeHooksConfig = {};

  for (const settingsPath of paths) {
    if (!existsSync(settingsPath)) continue;

    try {
      const content = await readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content) as { hooks?: RawClaudeHooksConfig };
      if (settings.hooks) {
        const normalizedHooks = normalizeHooksConfig(settings.hooks);
        mergedConfig = mergeHooksConfig(mergedConfig, normalizedHooks);
      }
    } catch {
      continue;
    }
  }

  return Object.keys(mergedConfig).length > 0 ? mergedConfig : null;
}

export type { ClaudeHooksConfig } from "./types";
