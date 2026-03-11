import type { ClaudeHooksConfig, PermissionDecision, PreToolUseInput, PreToolUseOutput } from "./types";
import { collectMatchingHookCommands } from "../shared/pattern-matcher";
import { executeHookCommand } from "../shared/execute-hook-command";
import { objectToSnakeCase } from "../shared/snake-case";
import { transformToolName } from "../shared/tool-name";
import { log } from "../shared/logger";
import { isHookCommandDisabled, type PluginExtendedConfig } from "../shared/hook-disable";
import { shouldAskForForegroundTask } from "./agent-execution-guard";

const DEFAULT_CONFIG = {
  forceZsh: process.platform !== "win32",
  zshPath: "/bin/zsh",
};

export interface PreToolUseContext {
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  cwd: string;
  transcriptPath?: string;
  toolUseId?: string;
  permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions";
}

export interface PreToolUseResult {
  decision: PermissionDecision;
  reason?: string;
  modifiedInput?: Record<string, unknown>;
  elapsedMs?: number;
  hookName?: string;
  toolName?: string;
  inputLines?: string;
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
}

function buildInputLines(toolInput: Record<string, unknown>): string {
  return Object.entries(toolInput)
    .slice(0, 3)
    .map(([key, val]) => {
      const valStr = String(val).slice(0, 40);
      return `  ${key}: ${valStr}${String(val).length > 40 ? "..." : ""}`;
    })
    .join("\n");
}

function getHookNameFromCommand(command: string): string {
  return command.split("/").pop() || command;
}

function isSecurityCriticalPreToolHook(command: string): boolean {
  return command.toLowerCase().includes("securityvalidator.hook");
}

function buildSecurityHookParseFailureReason(args: {
  hookName: string;
  kind: "empty" | "parse";
  stderr?: string;
}): string {
  const baseReason =
    args.kind === "empty"
      ? `Security-critical hook ${args.hookName} returned empty stdout with exit code 0`
      : `Security-critical hook ${args.hookName} returned non-JSON stdout (parse failure) with exit code 0`;
  const stderrReason = args.stderr ? ` (stderr: ${args.stderr})` : "";
  return `${baseReason}${stderrReason}; failing safe to ask.`;
}

export async function executePreToolUseHooks(
  ctx: PreToolUseContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null,
  settingsEnv?: Record<string, string>,
): Promise<PreToolUseResult> {
  if (!config) {
    return { decision: "allow" };
  }

  const transformedToolName = transformToolName(ctx.toolName);

  if (transformedToolName === "Task") {
    const runInBackground =
      ctx.toolInput.run_in_background === true || ctx.toolInput.runInBackground === true;
    const bypassAgentCheck =
      ctx.toolInput.bypassAgentCheck === true ||
      (typeof ctx.toolInput.extra === "object" &&
        ctx.toolInput.extra !== null &&
        (ctx.toolInput.extra as Record<string, unknown>).bypassAgentCheck === true);
    const subagentType =
      typeof ctx.toolInput.subagent_type === "string"
        ? ctx.toolInput.subagent_type
        : typeof ctx.toolInput.subagentType === "string"
          ? ctx.toolInput.subagentType
          : undefined;
    const prompt = typeof ctx.toolInput.prompt === "string" ? ctx.toolInput.prompt : undefined;

    if (
      !runInBackground &&
      shouldAskForForegroundTask({
        subagent_type: subagentType,
        prompt,
        bypassAgentCheck,
      })
    ) {
      return {
        decision: "ask",
        reason:
          "This task appears long-running or fan-out; consider task(run_in_background:true).",
      };
    }
  }

  const toolNamesToMatch =
    transformedToolName === "ApplyPatch" ? ["ApplyPatch", "Edit", "Write"] : [transformedToolName];
  const commandsToExecute = collectMatchingHookCommands(config, "PreToolUse", toolNamesToMatch);
  if (commandsToExecute.length === 0) {
    return { decision: "allow" };
  }

  const stdinData: PreToolUseInput = {
    session_id: ctx.sessionId,
    transcript_path: ctx.transcriptPath,
    cwd: ctx.cwd,
    permission_mode: ctx.permissionMode ?? "bypassPermissions",
    hook_event_name: "PreToolUse",
    tool_name: transformedToolName,
    tool_input: objectToSnakeCase(ctx.toolInput),
    tool_use_id: ctx.toolUseId,
    hook_source: "opencode-plugin",
  };

  const startTime = Date.now();
  const inputLines = buildInputLines(ctx.toolInput);
  const accumulatedCommonFields: Pick<
    PreToolUseResult,
    "continue" | "stopReason" | "suppressOutput" | "systemMessage"
  > = {};

  for (const command of commandsToExecute) {
    if (isHookCommandDisabled("PreToolUse", command, extendedConfig ?? null)) {
      log("PreToolUse hook command skipped (disabled by config)", {
        command,
        toolName: ctx.toolName,
      });
      continue;
    }

    const hookName = getHookNameFromCommand(command);
    const securityCriticalHook = isSecurityCriticalPreToolHook(command);

    const result = await executeHookCommand(command, JSON.stringify(stdinData), ctx.cwd, {
      forceZsh: DEFAULT_CONFIG.forceZsh,
      zshPath: DEFAULT_CONFIG.zshPath,
      env: settingsEnv,
    });

    if (result.exitCode === 2) {
      return {
        decision: "deny",
        reason: result.stderr || result.stdout || "Hook blocked the operation",
        elapsedMs: Date.now() - startTime,
        hookName,
        toolName: transformedToolName,
        inputLines,
      };
    }

    if (result.exitCode === 1) {
      return {
        decision: "ask",
        reason: result.stderr || result.stdout,
        elapsedMs: Date.now() - startTime,
        hookName,
        toolName: transformedToolName,
        inputLines,
      };
    }

    if (result.exitCode !== 0) {
      return {
        decision: "ask",
        reason:
          result.stderr ||
          result.stdout ||
          `Hook command exited unexpectedly with code ${result.exitCode}`,
        elapsedMs: Date.now() - startTime,
        hookName,
        toolName: transformedToolName,
        inputLines,
      };
    }

    if (!result.stdout && securityCriticalHook) {
      return {
        decision: "ask",
        reason: buildSecurityHookParseFailureReason({
          hookName,
          kind: "empty",
          stderr: result.stderr,
        }),
        elapsedMs: Date.now() - startTime,
        hookName,
        toolName: transformedToolName,
        inputLines,
        continue: accumulatedCommonFields.continue,
        stopReason: accumulatedCommonFields.stopReason,
        suppressOutput: accumulatedCommonFields.suppressOutput,
        systemMessage: accumulatedCommonFields.systemMessage,
      };
    }

    if (result.stdout) {
      try {
        const output = JSON.parse(result.stdout || "{}") as PreToolUseOutput;

        let decision: PermissionDecision | undefined;
        let reason: string | undefined;
        let modifiedInput: Record<string, unknown> | undefined;

        if (output.hookSpecificOutput?.permissionDecision) {
          decision = output.hookSpecificOutput.permissionDecision;
          reason = output.hookSpecificOutput.permissionDecisionReason;
          modifiedInput = output.hookSpecificOutput.updatedInput;
        } else if (output.decision) {
          const legacyDecision = output.decision;
          if (legacyDecision === "approve" || legacyDecision === "allow") {
            decision = "allow";
          } else if (legacyDecision === "block" || legacyDecision === "deny") {
            decision = "deny";
          } else if (legacyDecision === "ask") {
            decision = "ask";
          }
          reason = output.reason;
        }

        if (output.continue !== undefined) {
          accumulatedCommonFields.continue = output.continue;
        }
        if (output.stopReason !== undefined) {
          accumulatedCommonFields.stopReason = output.stopReason;
        }
        if (output.suppressOutput !== undefined) {
          accumulatedCommonFields.suppressOutput = output.suppressOutput;
        }
        if (output.systemMessage !== undefined) {
          accumulatedCommonFields.systemMessage = output.systemMessage;
        }

        if (decision) {
          return {
            decision,
            reason,
            modifiedInput,
            elapsedMs: Date.now() - startTime,
            hookName,
            toolName: transformedToolName,
            inputLines,
            continue: accumulatedCommonFields.continue,
            stopReason: accumulatedCommonFields.stopReason,
            suppressOutput: accumulatedCommonFields.suppressOutput,
            systemMessage: accumulatedCommonFields.systemMessage,
          };
        }

      } catch {
        if (securityCriticalHook) {
          return {
            decision: "ask",
            reason: buildSecurityHookParseFailureReason({
              hookName,
              kind: "parse",
              stderr: result.stderr,
            }),
            elapsedMs: Date.now() - startTime,
            hookName,
            toolName: transformedToolName,
            inputLines,
            continue: accumulatedCommonFields.continue,
            stopReason: accumulatedCommonFields.stopReason,
            suppressOutput: accumulatedCommonFields.suppressOutput,
            systemMessage: accumulatedCommonFields.systemMessage,
          };
        }

        // Ignore parse errors and continue.
      }
    }
  }

  return {
    decision: "allow",
    continue: accumulatedCommonFields.continue,
    stopReason: accumulatedCommonFields.stopReason,
    suppressOutput: accumulatedCommonFields.suppressOutput,
    systemMessage: accumulatedCommonFields.systemMessage,
  };
}
