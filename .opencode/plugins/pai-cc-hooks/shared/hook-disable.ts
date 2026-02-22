import type { ClaudeHookEvent } from "../claude/types";

export interface DisabledHooksConfig {
  SessionStart?: string[];
  SessionEnd?: string[];
  Stop?: string[];
  PreToolUse?: string[];
  PostToolUse?: string[];
  UserPromptSubmit?: string[];
  PreCompact?: string[];
}

export interface PluginExtendedConfig {
  disabledHooks?: DisabledHooksConfig;
}

const regexCache = new Map<string, RegExp>();

function getRegex(pattern: string): RegExp {
  let regex = regexCache.get(pattern);
  if (!regex) {
    try {
      regex = new RegExp(pattern);
    } catch {
      regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
    regexCache.set(pattern, regex);
  }
  return regex;
}

export function isHookCommandDisabled(
  eventType: ClaudeHookEvent,
  command: string,
  config: PluginExtendedConfig | null | undefined,
): boolean {
  if (!config?.disabledHooks) return false;

  const patterns = config.disabledHooks[eventType];
  if (!patterns || patterns.length === 0) return false;

  return patterns.some((pattern) => {
    const regex = getRegex(pattern);
    return regex.test(command);
  });
}
