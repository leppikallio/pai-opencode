/**
 * PAI-OpenCode Security Validator
 *
 * Validates tool executions for security threats.
 * Equivalent to PAI's security-validator.ts hook.
 *
 * @module security-validator
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileLog, fileLogError } from "../lib/file-logger";
import type { SecurityResult, PermissionInput, ToolInput } from "../adapters/types";
import { getPaiDir } from "../lib/pai-runtime";
import { ensureDir, getSecurityDir, getYearMonth } from "../lib/paths";

type UnknownRecord = Record<string, unknown>;

function summarizeArgKeys(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  return keys.slice(0, 20).join(",") + (keys.length > 20 ? ",..." : "");
}

function redactSensitiveText(text: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bsk-[A-Za-z0-9]{20,}\b/g, "sk-[REDACTED]"],
    [/\bghp_[A-Za-z0-9]{20,}\b/g, "ghp_[REDACTED]"],
    [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "AIza[REDACTED]"],
    [/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, "xox-[REDACTED]"],
    [
      /(-----BEGIN [A-Z ]+ PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]+ PRIVATE KEY-----)/g,
      "$1\n[REDACTED]\n$2",
    ],
    [
      /([?&](?:token|key|api_key|apikey|secret|password)=)[^&\s]+/gi,
      "$1[REDACTED]",
    ],
    [/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, "Authorization: Bearer [REDACTED]"],
    [/--password\s+\S+/gi, "--password [REDACTED]"],
    [/--token\s+\S+/gi, "--token [REDACTED]"],
    [/AWS\s*SECRET\s*ACCESS\s*KEY\s*=\s*\S+/gi, "AWS_SECRET_ACCESS_KEY<REDACTED>"],
    [/OPENAI\s*API\s*KEY\s*=\s*\S+/gi, "OPENAI_API_KEY<REDACTED>"],
  ];

  let out = text;
  for (const [re, repl] of replacements) out = out.replace(re, repl);

  const max = 240;
  if (out.length > max) out = `${out.slice(0, max)}…`;
  return out;
}

function getCategory(toolName: string, command: string): "bash_command" | "path_access" | "other" {
  const lowerTool = toolName.toLowerCase();
  if (["read", "write", "edit", "apply_patch"].includes(lowerTool)) return "path_access";
  if (command.startsWith("read:") || command.startsWith("write:") || command.startsWith("edit:")) {
    return "path_access";
  }
  if (lowerTool === "bash") return "bash_command";
  return "other";
}

/**
 * Check if a command matches any dangerous pattern
 */
type RawRule = {
  id?: string;
  pattern: string;
  description?: string;
  severity?: string;
  suggestion?: string;
};

type CompiledRule = RawRule & { id: string; regex: RegExp };

type SecurityRules = {
  enabled: boolean;
  blockDangerous: boolean;
  requireConfirm: boolean;
  maxCommandLength?: number;
};

type SecurityConfig = {
  rules: SecurityRules;
  dangerous: CompiledRule[];
  warning: CompiledRule[];
  allowed: CompiledRule[];
};

let configCache: SecurityConfig | null = null;

function hashRule(pattern: string): string {
  return createHash("sha1").update(pattern).digest("hex").slice(0, 10);
}

function stripQuotes(value: string): string {
  const v = value.trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parsePatternsYaml(content: string): {
  dangerous: RawRule[];
  warning: RawRule[];
  allowed: RawRule[];
  rules: Partial<SecurityRules>;
} {
  const dangerous: RawRule[] = [];
  const warning: RawRule[] = [];
  const allowed: RawRule[] = [];
  const rules: Partial<SecurityRules> = {};

  let section = "";
  let current: RawRule | null = null;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sectionMatch = trimmed.match(/^([A-Z_]+):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      current = null;
      continue;
    }

    if (["DANGEROUS_PATTERNS", "WARNING_PATTERNS", "ALLOWED_PATTERNS"].includes(section)) {
      if (trimmed.startsWith("-")) {
        current = { pattern: "" };
        const inline = trimmed.replace(/^[-\s]+/, "");
        const match = inline.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
        if (match) {
          const key = match[1];
          const val = stripQuotes(match[2]);
          (current as UnknownRecord)[key] = val;
        }
        if (section === "DANGEROUS_PATTERNS") dangerous.push(current);
        if (section === "WARNING_PATTERNS") warning.push(current);
        if (section === "ALLOWED_PATTERNS") allowed.push(current);
        continue;
      }
      if (current) {
        const match = trimmed.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
        if (match) {
          const key = match[1];
          const val = stripQuotes(match[2]);
          (current as UnknownRecord)[key] = val;
        }
      }
      continue;
    }

    if (section === "SECURITY_RULES") {
      const match = trimmed.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
      if (!match) continue;
      const key = match[1];
      const val = stripQuotes(match[2]);
      if (val === "true" || val === "false") {
        (rules as UnknownRecord)[key] = val === "true";
      } else if (/^\d+$/.test(val)) {
        (rules as UnknownRecord)[key] = Number(val);
      } else {
        (rules as UnknownRecord)[key] = val;
      }
    }
  }

  return { dangerous, warning, allowed, rules };
}

function compileRules(raw: RawRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const rule of raw) {
    if (!rule.pattern) continue;
    try {
      compiled.push({
        ...rule,
        id: rule.id || hashRule(rule.pattern),
        regex: new RegExp(rule.pattern),
      });
    } catch {
      // Skip invalid patterns
    }
  }
  return compiled;
}

function loadSecurityConfig(): SecurityConfig {
  if (configCache) return configCache;

  const paiDir = getPaiDir();
  const baseDir = path.join(paiDir, "PAISECURITYSYSTEM");
  const userDir = path.join(paiDir, "USER", "PAISECURITYSYSTEM");
  const overridePath = path.join(userDir, "patterns.yaml");
  const defaultPath = path.join(baseDir, "patterns.example.yaml");

  let content = "";
  if (fs.existsSync(overridePath)) {
    content = fs.readFileSync(overridePath, "utf-8");
  } else if (fs.existsSync(defaultPath)) {
    content = fs.readFileSync(defaultPath, "utf-8");
  }

  const parsed = parsePatternsYaml(content);
  const rawMax = (parsed.rules as UnknownRecord).max_command_length;
  const maxCommandLength =
    typeof parsed.rules.maxCommandLength === "number"
      ? parsed.rules.maxCommandLength
      : typeof rawMax === "number"
        ? rawMax
        : undefined;

  const rules: SecurityRules = {
    enabled: parsed.rules.enabled !== false,
    blockDangerous:
      parsed.rules.blockDangerous ?? (parsed.rules as UnknownRecord).block_dangerous !== false,
    requireConfirm:
      parsed.rules.requireConfirm ??
      (parsed.rules as UnknownRecord).require_confirmation_for_warnings !== false,
    maxCommandLength,
  };

  configCache = {
    rules,
    dangerous: compileRules(parsed.dangerous),
    warning: compileRules(parsed.warning),
    allowed: compileRules(parsed.allowed),
  };

  return configCache;
}

function matchesRule(rules: CompiledRule[], command: string): CompiledRule | null {
  for (const rule of rules) {
    if (rule.regex.test(command)) return rule;
  }
  return null;
}

async function appendSecurityLog(entry: Record<string, unknown>) {
  const dir = path.join(getSecurityDir(), getYearMonth());
  const filePath = path.join(dir, "security.jsonl");
  try {
    await ensureDir(dir);
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > 10 * 1024 * 1024) {
        const rotated = filePath.replace(/\.jsonl$/, `.${Date.now()}.jsonl`);
        await fs.promises.rename(filePath, rotated);
      }
    } catch {
      // ignore
    }
    await fs.promises.appendFile(filePath, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    fileLogError("Failed to write security log", error);
  }
}

/**
 * Extract command from tool input
 */
function extractCommand(input: PermissionInput | ToolInput): string | null {
  // Normalize tool name to lowercase for comparison
  const toolName = input.tool.toLowerCase();

  // Bash tool (handles both "bash" and "Bash")
  if (toolName === "bash" && typeof input.args?.command === "string") {
    return input.args.command;
  }

  // File tools - check for sensitive paths
  if (["write", "read", "edit", "apply_patch"].includes(toolName)) {
    const filePath =
      typeof input.args?.filePath === "string"
        ? input.args.filePath
        : typeof input.args?.file_path === "string"
          ? input.args.file_path
          : undefined;
    if (typeof filePath === "string") return `${toolName}:${filePath}`;
  }

  return null;
}

/**
 * Check for prompt injection patterns in content
 */
function checkPromptInjection(content: string): boolean {
  const injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /you\s+are\s+now\s+/i,
    /system\s*:\s*you\s+are/i,
    /override\s+security/i,
    /disable\s+safety/i,
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(content)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate security for a tool execution
 *
 * @param input - The tool or permission input to validate
 * @returns SecurityResult indicating what action to take
 */
export async function validateSecurity(
  input: PermissionInput | ToolInput
): Promise<SecurityResult> {
  try {
    const config = loadSecurityConfig();
    if (!config.rules.enabled) {
      return { action: "allow", reason: "Security rules disabled" };
    }

    fileLog(`Security check for tool: ${input.tool}`);
    const argKeys = summarizeArgKeys(input.args);
    if (argKeys) fileLog(`Arg keys: ${argKeys}`, "debug");

    const command = extractCommand(input);

    if (!command) {
      fileLog(`No command extracted from input`, "warn");
      // No command to validate - allow by default
      await appendSecurityLog({
        v: "0.1",
        ts: new Date().toISOString(),
        sessionId: (input as ToolInput).sessionID ?? "",
        tool: input.tool,
        action: "allow",
        category: "other",
        targetPreview: "",
        ruleId: "allow.no_command",
        reason: "No command to validate",
        sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
      });
      return {
        action: "allow",
        reason: "No command to validate",
      };
    }

    const redactedCommand = redactSensitiveText(command);
    const category = getCategory(input.tool, command);
    fileLog(`Extracted command: ${redactedCommand}`, "info");

    if (config.rules.maxCommandLength && command.length > config.rules.maxCommandLength) {
      await appendSecurityLog({
        v: "0.1",
        ts: new Date().toISOString(),
        sessionId: (input as ToolInput).sessionID ?? "",
        tool: input.tool,
        action: "confirm",
        category,
        targetPreview: redactedCommand,
        ruleId: "len.max",
        reason: "Command length exceeds max",
        sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
      });
      return {
        action: "confirm",
        reason: "Command length exceeds configured maximum",
        message: "Command is unusually long. Please confirm.",
      };
    }

    const allowed = matchesRule(config.allowed, command);
    if (allowed) {
      await appendSecurityLog({
        v: "0.1",
        ts: new Date().toISOString(),
        sessionId: (input as ToolInput).sessionID ?? "",
        tool: input.tool,
        action: "allow",
        category,
        targetPreview: redactedCommand,
        ruleId: allowed.id,
        reason: allowed.description ?? "Allowed pattern",
        sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
      });
      return { action: "allow", reason: "Allowed pattern" };
    }

    // Check for dangerous patterns (BLOCK)
    const dangerousMatch = matchesRule(config.dangerous, command);
    if (dangerousMatch) {
      const action = config.rules.blockDangerous ? "block" : "confirm";
      await appendSecurityLog({
        v: "0.1",
        ts: new Date().toISOString(),
        sessionId: (input as ToolInput).sessionID ?? "",
        tool: input.tool,
        action,
        category,
        targetPreview: redactedCommand,
        ruleId: dangerousMatch.id,
        reason: dangerousMatch.description ?? "Dangerous pattern",
        sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
      });
      fileLog(`BLOCKED: Dangerous pattern matched: ${dangerousMatch.pattern}`, "error");
      return {
        action,
        reason: `Dangerous command pattern detected: ${dangerousMatch.pattern}`,
        message:
          "This command has been blocked for security reasons. It matches a known dangerous pattern.",
      };
    }

    // Check for prompt injection in content
    if (input.args?.content && typeof input.args.content === "string") {
      if (checkPromptInjection(input.args.content)) {
        fileLog("BLOCKED: Prompt injection detected", "error");
        return {
          action: "block",
          reason: "Potential prompt injection detected in content",
          message:
            "Content appears to contain prompt injection patterns and has been blocked.",
        };
      }
    }

    // Check for warning patterns (CONFIRM)
    const warningMatch = matchesRule(config.warning, command);
    if (warningMatch) {
      const action = config.rules.requireConfirm ? "confirm" : "allow";
      await appendSecurityLog({
        v: "0.1",
        ts: new Date().toISOString(),
        sessionId: (input as ToolInput).sessionID ?? "",
        tool: input.tool,
        action,
        category,
        targetPreview: redactedCommand,
        ruleId: warningMatch.id,
        reason: warningMatch.description ?? "Warning pattern",
        sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
      });
      fileLog(`CONFIRM: Warning pattern matched: ${warningMatch.pattern}`, "warn");
      return {
        action,
        reason: `Potentially dangerous command: ${warningMatch.pattern}`,
        message:
          "This command may have unintended consequences. Please confirm.",
      };
    }

    // Check for sensitive file writes
    if (input.tool.toLowerCase() === "write") {
      const filePath =
        typeof input.args?.filePath === "string"
          ? (input.args.filePath as string)
          : typeof input.args?.file_path === "string"
            ? (input.args.file_path as string)
            : undefined;
      if (!filePath) {
        fileLog("Write tool used without file path", "warn");
        return {
          action: "allow",
          reason: "Write tool used without a file path",
        };
      }
      const sensitivePaths = [
        /\/etc\//,
        /\/var\/log\//,
        /\.ssh\//,
        /\.aws\//,
        /\.env$/,
        /credentials/i,
        /secret/i,
      ];

      for (const pattern of sensitivePaths) {
        if (pattern.test(filePath)) {
          fileLog(`CONFIRM: Sensitive file write: ${filePath}`, "warn");
          await appendSecurityLog({
            v: "0.1",
            ts: new Date().toISOString(),
            sessionId: (input as ToolInput).sessionID ?? "",
            tool: input.tool,
            action: "confirm",
            category: "path_access",
            targetPreview: redactSensitiveText(filePath),
            ruleId: "path.sensitive",
            reason: "Writing to sensitive path",
            sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
          });
          return {
            action: "confirm",
            reason: `Writing to sensitive path: ${filePath}`,
            message: "Writing to a potentially sensitive location. Please confirm.",
          };
        }
      }
    }

    // All checks passed - allow
    await appendSecurityLog({
      v: "0.1",
      ts: new Date().toISOString(),
      sessionId: (input as ToolInput).sessionID ?? "",
      tool: input.tool,
      action: "allow",
        category,
      targetPreview: redactedCommand,
      ruleId: "allow.default",
      reason: "All security checks passed",
      sourceEventId: `${input.tool}:${(input as ToolInput).sessionID ?? ""}:${(input as ToolInput).callID ?? ""}`,
    });
    fileLog("Security check passed", "debug");
    return {
      action: "allow",
      reason: "All security checks passed",
    };
  } catch (error) {
    fileLogError("Security validation error", error);
    // Fail-open: on error, allow the operation
    // This is a design decision - fail-closed would be safer but more disruptive
    return {
      action: "allow",
      reason: "Security check error - allowing by default",
    };
  }
}
