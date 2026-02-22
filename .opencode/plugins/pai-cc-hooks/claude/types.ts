/**
 * Claude Code Hooks Type Definitions
 * Maps Claude Code hook concepts to OpenCode plugin events.
 */

export type ClaudeHookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "PreCompact";

export interface HookMatcher {
  matcher: string;
  hooks: HookCommand[];
}

export interface HookCommand {
  type: "command";
  command: string;
}

export interface ClaudeHooksConfig {
  PreToolUse?: HookMatcher[];
  PostToolUse?: HookMatcher[];
  UserPromptSubmit?: HookMatcher[];
  SessionStart?: HookMatcher[];
  SessionEnd?: HookMatcher[];
  Stop?: HookMatcher[];
  PreCompact?: HookMatcher[];
}

export interface SessionStartInput {
  session_id: string;
  cwd: string;
  hook_event_name: "SessionStart";
  hook_source?: HookSource;
}

export interface SessionEndInput {
  session_id: string;
  cwd: string;
  hook_event_name: "SessionEnd";
  hook_source?: HookSource;
}

export interface PreToolUseInput {
  session_id: string;
  transcript_path?: string;
  cwd: string;
  permission_mode?: PermissionMode;
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id?: string;
  hook_source?: HookSource;
}

export interface PostToolUseInput {
  session_id: string;
  transcript_path?: string;
  cwd: string;
  permission_mode?: PermissionMode;
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: {
    title?: string;
    output?: string;
    [key: string]: unknown;
  };
  tool_use_id?: string;
  hook_source?: HookSource;
}

export interface UserPromptSubmitInput {
  session_id: string;
  cwd: string;
  permission_mode?: PermissionMode;
  hook_event_name: "UserPromptSubmit";
  prompt: string;
  session?: {
    id: string;
  };
  hook_source?: HookSource;
}

export type PermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions";

export type HookSource = "opencode-plugin";

export interface StopInput {
  session_id: string;
  transcript_path?: string;
  cwd: string;
  permission_mode?: PermissionMode;
  hook_event_name: "Stop";
  stop_hook_active: boolean;
  todo_path?: string;
  hook_source?: HookSource;
}

export type PermissionDecision = "allow" | "deny" | "ask";

/**
 * Common JSON fields for all hook outputs (Claude Code spec)
 */
export interface HookCommonOutput {
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
}

export interface PreToolUseOutput extends HookCommonOutput {
  decision?: "allow" | "deny" | "approve" | "block" | "ask";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision: PermissionDecision;
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
  };
}

export interface PostToolUseOutput extends HookCommonOutput {
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: "PostToolUse";
    additionalContext?: string;
  };
}

export interface HookResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface StopOutput {
  decision?: "block" | "continue";
  reason?: string;
  stop_hook_active?: boolean;
  permission_mode?: PermissionMode;
  inject_prompt?: string;
}

export interface PluginConfig {
  disabledHooks?: boolean | ClaudeHookEvent[];
  keywordDetectorDisabled?: boolean;
}
