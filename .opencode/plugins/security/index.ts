import * as os from "node:os";
import * as path from "node:path";

import { fileLog, fileLogError } from "../lib/file-logger";
import { getPaiDir } from "../lib/pai-runtime";
import type { PermissionInput, SecurityResult, ToolInput } from "../adapters/types";
import { createSecurityAuditLogger, type AppendSecurityAuditLog } from "./audit-log";
import { detectKnownBashBypass, matchesRule } from "./bash-policy";
import { checkPromptInjection } from "./content-policy";
import {
  createAlertPatternDecision,
  createAllChecksPassedDecision,
  createAllowedPatternDecision,
  createBlockedFilePathDecision,
  createBlockedPatchPathDecision,
  createBypassDecision,
  createCommandLengthDecision,
  createConfirmFilePathDecision,
  createConfirmPatchPathDecision,
  createDangerousPatternDecision,
  createNoCommandDecision,
  createPromptInjectionDecision,
  createSecurityRulesDisabledDecision,
  createSensitivePathDecision,
  createValidatorErrorDecision,
  createWarningPatternDecision,
  createWriteWithoutPathDecision,
  getSecuritySessionId,
  getSecuritySourceEventId,
} from "./decision";
import {
  extractApplyPatchPaths,
  matchesPathPattern,
  resolveApplyPatchPaths,
  type PathAction,
  validatePathAccess,
} from "./path-policy";
import {
  createSecurityPolicyLoader,
  type CompiledRule,
  type SecurityConfig,
  type SecurityPolicyLoader,
} from "./policy-loader";
import {
  getRuntimeCwdFromInput,
  resolveEffectiveProjectConfig,
  type CompiledProjectRules,
} from "./project-rules";
import { redactSensitiveText } from "./redaction";
import { extractCommand, getSecurityCategory, summarizeArgKeys } from "./tool-normalization";
export {
  createSecurityPermissionAskFallback,
  createSecurityPermissionDecisionFromError,
  createSecurityPermissionDecisionFromResult,
  mapSecurityActionToPermissionStatus,
  mapSecurityResultToPermissionStatus,
  type SecurityPermissionDecision,
  type SecurityPermissionStatus,
} from "./adapter-decision";

type SecurityInput = PermissionInput | ToolInput;

type SecurityAuditBase = {
  v: "0.1";
  ts: string;
  sessionId: string;
  tool: string;
  sourceEventId: string;
};

function expandTildePath(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

export function normalizeSecurityInputArgs(value: unknown): unknown {
  if (typeof value === "string") {
    return expandTildePath(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSecurityInputArgs(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    out[key] = normalizeSecurityInputArgs(nestedValue);
  }

  return out;
}

type ValidatorConfig = SecurityConfig & {
  projects: CompiledProjectRules<CompiledRule>[];
};

export type SecurityValidator = {
  validateSecurity(input: SecurityInput): Promise<SecurityResult>;
  resetPolicyCache(): void;
};

export type CreateSecurityValidatorOptions = {
  paiDir?: string;
  policyLoader?: SecurityPolicyLoader;
  appendAuditLog?: AppendSecurityAuditLog;
};

function buildSecurityAuditBase(input: SecurityInput): SecurityAuditBase {
  return {
    v: "0.1",
    ts: new Date().toISOString(),
    sessionId: getSecuritySessionId(input),
    tool: input.tool,
    sourceEventId: getSecuritySourceEventId(input),
  };
}

export function createSecurityValidator(options?: CreateSecurityValidatorOptions): SecurityValidator {
  const policyLoader =
    options?.policyLoader ??
    createSecurityPolicyLoader({
      paiDir: options?.paiDir,
    });

  const appendAuditLog = options?.appendAuditLog ?? createSecurityAuditLogger();

  const resolvePaiDir = (): string => {
    if (options?.paiDir) {
      return options.paiDir;
    }

    return getPaiDir();
  };

  async function validateSecurity(input: SecurityInput): Promise<SecurityResult> {
    try {
      const runtimeCwd = getRuntimeCwdFromInput(input);
      const config = resolveEffectiveProjectConfig(
        policyLoader.loadSecurityConfig() as ValidatorConfig,
        runtimeCwd,
        matchesPathPattern,
      );

      if (!config.rules.enabled) {
        return createSecurityRulesDisabledDecision();
      }

      fileLog(`Security check for tool: ${input.tool}`);
      const argKeys = summarizeArgKeys(input.args);
      if (argKeys) fileLog(`Arg keys: ${argKeys}`, "debug");

      const command = extractCommand(input);
      const auditBase = buildSecurityAuditBase(input);

      if (!command) {
        fileLog("No command extracted from input", "warn");
        await appendAuditLog({
          ...auditBase,
          action: "allow",
          category: "other",
          targetPreview: "",
          ruleId: "allow.no_command",
          reason: "No command to validate",
        });

        return createNoCommandDecision();
      }

      const redactedCommand = redactSensitiveText(command);
      const category = getSecurityCategory(input.tool, command);
      fileLog(`Extracted command: ${redactedCommand}`, "info");

      if (config.rules.maxCommandLength && command.length > config.rules.maxCommandLength) {
        await appendAuditLog({
          ...auditBase,
          action: "confirm",
          category,
          targetPreview: redactedCommand,
          ruleId: "len.max",
          reason: "Command length exceeds max",
        });

        return createCommandLengthDecision();
      }

      if (input.tool.toLowerCase() === "bash") {
        const bypass = detectKnownBashBypass(command);
        if (bypass) {
          const action = config.rules.blockDangerous ? "block" : "confirm";
          await appendAuditLog({
            ...auditBase,
            action,
            category,
            targetPreview: redactedCommand,
            ruleId: bypass.id,
            reason: bypass.reason,
          });

          return createBypassDecision(action, bypass.reason);
        }
      }

      const allowedMatch = matchesRule(config.allowed, command);
      if (allowedMatch) {
        await appendAuditLog({
          ...auditBase,
          action: "allow",
          category,
          targetPreview: redactedCommand,
          ruleId: allowedMatch.id,
          reason: allowedMatch.description ?? "Allowed pattern",
        });

        return createAllowedPatternDecision();
      }

      const dangerousMatch = matchesRule(config.dangerous, command);
      if (dangerousMatch) {
        const action = config.rules.blockDangerous ? "block" : "confirm";
        await appendAuditLog({
          ...auditBase,
          action,
          category,
          targetPreview: redactedCommand,
          ruleId: dangerousMatch.id,
          reason: dangerousMatch.description ?? "Dangerous pattern",
        });

        fileLog(`BLOCKED: Dangerous pattern matched: ${dangerousMatch.pattern}`, "error");
        return createDangerousPatternDecision(action, dangerousMatch.pattern);
      }

      if (input.args?.content && typeof input.args.content === "string") {
        if (checkPromptInjection(input.args.content)) {
          fileLog("BLOCKED: Prompt injection detected", "error");
          return createPromptInjectionDecision();
        }
      }

      if (["read", "write", "edit", "apply_patch"].includes(input.tool.toLowerCase())) {
        if (input.tool.toLowerCase() === "apply_patch" && typeof input.args?.patchText === "string") {
          const paiDir = resolvePaiDir();
          const items = extractApplyPatchPaths(input.args.patchText);

          for (const item of items) {
            const resolvedPaths = resolveApplyPatchPaths({
              paiDir,
              cwd: runtimeCwd,
              filePathRaw: item.filePath,
            });

            let confirm: { path: string; reason?: string } | null = null;

            for (const resolvedPath of resolvedPaths) {
              const result = validatePathAccess(resolvedPath, item.action, config.pathRules);
              if (result.action === "block") {
                await appendAuditLog({
                  ...auditBase,
                  action: "block",
                  category: "path_access",
                  targetPreview: redactSensitiveText(resolvedPath),
                  ruleId: "path.block",
                  reason: result.reason ?? "Path blocked",
                });

                return createBlockedPatchPathDecision(result.reason);
              }

              if (result.action === "confirm" && !confirm) {
                confirm = { path: resolvedPath, reason: result.reason };
              }
            }

            if (confirm) {
              await appendAuditLog({
                ...auditBase,
                action: "confirm",
                category: "path_access",
                targetPreview: redactSensitiveText(confirm.path),
                ruleId: "path.confirm",
                reason: confirm.reason ?? "Protected path write",
              });

              return createConfirmPatchPathDecision(confirm.reason);
            }
          }
        }

        const filePath =
          typeof input.args?.filePath === "string"
            ? (input.args.filePath as string)
            : typeof input.args?.file_path === "string"
              ? (input.args.file_path as string)
              : undefined;

        if (filePath) {
          const pathAction: PathAction = input.tool.toLowerCase() === "read" ? "read" : "write";
          const pathResult = validatePathAccess(filePath, pathAction, config.pathRules);

          if (pathResult.action === "block") {
            await appendAuditLog({
              ...auditBase,
              action: "block",
              category: "path_access",
              targetPreview: redactSensitiveText(filePath),
              ruleId: "path.block",
              reason: pathResult.reason ?? "Path blocked",
            });

            return createBlockedFilePathDecision(pathResult.reason);
          }

          if (pathResult.action === "confirm") {
            await appendAuditLog({
              ...auditBase,
              action: "confirm",
              category: "path_access",
              targetPreview: redactSensitiveText(filePath),
              ruleId: "path.confirm",
              reason: pathResult.reason ?? "Protected path write",
            });

            return createConfirmFilePathDecision(pathResult.reason);
          }
        }
      }

      const warningMatch = matchesRule(config.warning, command);
      if (warningMatch) {
        const action = config.rules.requireConfirm ? "confirm" : "allow";
        await appendAuditLog({
          ...auditBase,
          action,
          category,
          targetPreview: redactedCommand,
          ruleId: warningMatch.id,
          reason: warningMatch.description ?? "Warning pattern",
        });

        fileLog(`CONFIRM: Warning pattern matched: ${warningMatch.pattern}`, "warn");
        return createWarningPatternDecision(action, warningMatch.pattern);
      }

      const alertMatch = matchesRule(config.alert, command);
      if (alertMatch) {
        await appendAuditLog({
          ...auditBase,
          action: "allow",
          category,
          targetPreview: redactedCommand,
          ruleId: alertMatch.id,
          reason: alertMatch.description ?? "Alert pattern",
        });

        fileLog(`ALERT: Pattern matched (allowed): ${alertMatch.pattern}`, "warn");
        return createAlertPatternDecision();
      }

      if (input.tool.toLowerCase() === "write") {
        const filePath =
          typeof input.args?.filePath === "string"
            ? (input.args.filePath as string)
            : typeof input.args?.file_path === "string"
              ? (input.args.file_path as string)
              : undefined;

        if (!filePath) {
          fileLog("Write tool used without file path", "warn");
          return createWriteWithoutPathDecision();
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
            await appendAuditLog({
              ...auditBase,
              action: "confirm",
              category: "path_access",
              targetPreview: redactSensitiveText(filePath),
              ruleId: "path.sensitive",
              reason: "Writing to sensitive path",
            });

            return createSensitivePathDecision(filePath);
          }
        }
      }

      await appendAuditLog({
        ...auditBase,
        action: "allow",
        category,
        targetPreview: redactedCommand,
        ruleId: "allow.default",
        reason: "All security checks passed",
      });

      fileLog("Security check passed", "debug");
      return createAllChecksPassedDecision();
    } catch (error) {
      fileLogError("Security validation error", error);
      return createValidatorErrorDecision();
    }
  }

  return {
    validateSecurity,
    resetPolicyCache: () => policyLoader.resetCache(),
  };
}

const defaultSecurityValidator = createSecurityValidator();

export async function validateSecurity(input: SecurityInput): Promise<SecurityResult> {
  return defaultSecurityValidator.validateSecurity(input);
}

export function resetSecurityPolicyCache(): void {
  defaultSecurityValidator.resetPolicyCache();
}

export { extractApplyPatchPaths, resolveApplyPatchPaths };
