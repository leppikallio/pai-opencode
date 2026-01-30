/**
 * PAI-OpenCode Security Validator
 *
 * Validates tool executions for security threats.
 * Equivalent to PAI's security-validator.ts hook.
 *
 * @module security-validator
 */

import { fileLog, fileLogError } from "../lib/file-logger";
import type {
  SecurityResult,
  PermissionInput,
  ToolInput,
} from "../adapters/types";
import { DANGEROUS_PATTERNS, WARNING_PATTERNS } from "../adapters/types";

function summarizeArgKeys(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  return keys.slice(0, 20).join(",") + (keys.length > 20 ? ",..." : "");
}

function redactSensitiveText(text: string): string {
  // Best-effort redaction for logs only. Never intended to be perfect.
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
  ];

  let out = text;
  for (const [re, repl] of replacements) out = out.replace(re, repl);

  const max = 240;
  if (out.length > max) out = out.slice(0, max) + "…";
  return out;
}

/**
 * Check if a command matches any dangerous pattern
 */
function matchesDangerousPattern(command: string): RegExp | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Check if a command matches any warning pattern
 */
function matchesWarningPattern(command: string): RegExp | null {
  for (const pattern of WARNING_PATTERNS) {
    if (pattern.test(command)) {
      return pattern;
    }
  }
  return null;
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

  // Write tool - check for sensitive paths
  if (toolName === "write") {
    const filePath =
      typeof input.args?.filePath === "string"
        ? input.args.filePath
        : typeof input.args?.file_path === "string"
          ? input.args.file_path
          : undefined;
    if (typeof filePath === "string") return `write:${filePath}`;
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
    fileLog(`Security check for tool: ${input.tool}`);
    const argKeys = summarizeArgKeys(input.args);
    if (argKeys) fileLog(`Arg keys: ${argKeys}`, "debug");

    const command = extractCommand(input);

    if (!command) {
      fileLog(`No command extracted from input`, "warn");
      // No command to validate - allow by default
      return {
        action: "allow",
        reason: "No command to validate",
      };
    }

    fileLog(`Extracted command: ${redactSensitiveText(command)}`, "info");

    // Check for dangerous patterns (BLOCK)
    const dangerousMatch = matchesDangerousPattern(command);
    if (dangerousMatch) {
      fileLog(`BLOCKED: Dangerous pattern matched: ${dangerousMatch}`, "error");
      return {
        action: "block",
        reason: `Dangerous command pattern detected: ${dangerousMatch}`,
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
    const warningMatch = matchesWarningPattern(command);
    if (warningMatch) {
      fileLog(`CONFIRM: Warning pattern matched: ${warningMatch}`, "warn");
      return {
        action: "confirm",
        reason: `Potentially dangerous command: ${warningMatch}`,
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
          return {
            action: "confirm",
            reason: `Writing to sensitive path: ${filePath}`,
            message: "Writing to a potentially sensitive location. Please confirm.",
          };
        }
      }
    }

    // All checks passed - allow
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
