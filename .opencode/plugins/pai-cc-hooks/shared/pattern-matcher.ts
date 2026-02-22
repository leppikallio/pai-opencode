import type { ClaudeHooksConfig, HookMatcher } from "../claude/types";

/**
 * Escape all regex special characters EXCEPT asterisk (*).
 * Asterisk is preserved for glob-to-regex conversion.
 */
function escapeRegexExceptAsterisk(str: string): string {
  return str.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesToolMatcher(toolName: string, matcher: string): boolean {
  if (!matcher) {
    return true;
  }
  const patterns = matcher.split("|").map((p) => p.trim());
  return patterns.some((p) => {
    if (p.includes("*")) {
      const escaped = escapeRegexExceptAsterisk(p);
      const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
      return regex.test(toolName);
    }
    return p.toLowerCase() === toolName.toLowerCase();
  });
}

export function findMatchingHooks(
  config: ClaudeHooksConfig,
  eventName: keyof ClaudeHooksConfig,
  toolName?: string,
): HookMatcher[] {
  const hookMatchers = config[eventName];
  if (!hookMatchers) return [];

  return hookMatchers.filter((hookMatcher) => {
    if (!toolName) return true;
    return matchesToolMatcher(toolName, hookMatcher.matcher);
  });
}

export function collectMatchingHookCommands(
  config: ClaudeHooksConfig,
  eventName: "PreToolUse" | "PostToolUse",
  toolNames: string[],
): string[] {
  const commands: string[] = [];
  const seen = new Set<string>();

  for (const toolName of toolNames) {
    const matchers = findMatchingHooks(config, eventName, toolName);
    for (const matcher of matchers) {
      if (!matcher.hooks || matcher.hooks.length === 0) continue;
      for (const hook of matcher.hooks) {
        if (hook.type !== "command") continue;
        if (seen.has(hook.command)) continue;
        seen.add(hook.command);
        commands.push(hook.command);
      }
    }
  }

  return commands;
}
