import type { PermissionInput, SecurityResult, ToolInput } from "../adapters/types";

export type SecurityAction = SecurityResult["action"];

function createDecision(action: SecurityAction, reason: string, message?: string): SecurityResult {
  if (message !== undefined) {
    return { action, reason, message };
  }

  return { action, reason };
}

export function getSecurityMessageForBypass(action: SecurityAction): string {
  if (action === "block") {
    return "This command appears to hide destructive intent via shell indirection and has been blocked.";
  }

  return "This command appears to hide destructive intent via shell indirection. Please confirm before proceeding.";
}

export function getSecurityMessageForDangerousPattern(action: SecurityAction): string {
  if (action === "block") {
    return "This command has been blocked for security reasons. It matches a known dangerous pattern.";
  }

  return "This command matches a known dangerous pattern. Please confirm before proceeding.";
}

export function createSecurityRulesDisabledDecision(): SecurityResult {
  return createDecision("allow", "Security rules disabled");
}

export function createNoCommandDecision(): SecurityResult {
  return createDecision("allow", "No command to validate");
}

export function createCommandLengthDecision(): SecurityResult {
  return createDecision(
    "confirm",
    "Command length exceeds configured maximum",
    "Command is unusually long. Please confirm.",
  );
}

export function createBypassDecision(action: SecurityAction, reason: string): SecurityResult {
  return createDecision(action, reason, getSecurityMessageForBypass(action));
}

export function createAllowedPatternDecision(): SecurityResult {
  return createDecision("allow", "Allowed pattern");
}

export function createDangerousPatternDecision(action: SecurityAction, pattern: string): SecurityResult {
  return createDecision(
    action,
    `Dangerous command pattern detected: ${pattern}`,
    getSecurityMessageForDangerousPattern(action),
  );
}

export function createPromptInjectionDecision(): SecurityResult {
  return createDecision(
    "block",
    "Potential prompt injection detected in content",
    "Content appears to contain prompt injection patterns and has been blocked.",
  );
}

export function createBlockedPatchPathDecision(reason?: string): SecurityResult {
  return createDecision("block", reason ?? "Blocked path access", "This patch targets a blocked file path.");
}

export function createConfirmPatchPathDecision(reason?: string): SecurityResult {
  return createDecision(
    "confirm",
    reason ?? "Protected path write",
    "This patch targets a protected file path. Please confirm.",
  );
}

export function createBlockedFilePathDecision(reason?: string): SecurityResult {
  return createDecision(
    "block",
    reason ?? "Blocked path access",
    "This file path is blocked by security rules.",
  );
}

export function createConfirmFilePathDecision(reason?: string): SecurityResult {
  return createDecision(
    "confirm",
    reason ?? "Protected path write",
    "Writing to a protected path. Please confirm.",
  );
}

export function createWarningPatternDecision(action: SecurityAction, pattern: string): SecurityResult {
  return createDecision(
    action,
    `Potentially dangerous command: ${pattern}`,
    "This command may have unintended consequences. Please confirm.",
  );
}

export function createAlertPatternDecision(): SecurityResult {
  return createDecision("allow", "Alert pattern (logged)");
}

export function createWriteWithoutPathDecision(): SecurityResult {
  return createDecision("allow", "Write tool used without a file path");
}

export function createSensitivePathDecision(filePath: string): SecurityResult {
  return createDecision(
    "confirm",
    `Writing to sensitive path: ${filePath}`,
    "Writing to a potentially sensitive location. Please confirm.",
  );
}

export function createAllChecksPassedDecision(): SecurityResult {
  return createDecision("allow", "All security checks passed");
}

export function createValidatorErrorDecision(): SecurityResult {
  return createDecision(
    "confirm",
    "Security validator error",
    "Security validator encountered an error. Please confirm to proceed.",
  );
}

export function getSecuritySourceEventId(input: PermissionInput | ToolInput): string {
  const toolInput = input as ToolInput;
  return `${input.tool}:${toolInput.sessionID ?? ""}:${toolInput.callID ?? ""}`;
}

export function getSecuritySessionId(input: PermissionInput | ToolInput): string {
  const toolInput = input as ToolInput;
  return toolInput.sessionID ?? "";
}
