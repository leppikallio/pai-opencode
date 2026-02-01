/**
 * PAI-OpenCode Shared Types
 *
 * Common TypeScript interfaces for plugin handlers and adapters.
 *
 * @module types
 */

/**
 * Security validation result
 *
 * Returned by security-validator.ts to indicate what action to take
 */
export interface SecurityResult {
  /** Action to take: block (deny), confirm (ask), or allow */
  action: "block" | "confirm" | "allow";
  /** Reason for the action (for logging) */
  reason: string;
  /** Optional detailed message for user */
  message?: string;
}

/**
 * Context loading result
 *
 * Returned by context-loader.ts
 */
export interface ContextResult {
  /** The context string to inject */
  context: string;
  /** Whether loading was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Tool execution input (from OpenCode plugin API)
 */
export interface ToolInput {
  /** Tool name (Bash, Read, Write, etc.) */
  tool: string;
  /** Tool arguments */
  args?: Record<string, unknown>;
  /** Session ID */
  sessionID?: string;
  /** Tool call ID */
  callID?: string;
}

/**
 * Permission check input (from OpenCode plugin API)
 */
export interface PermissionInput {
  /** Tool name */
  tool: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Permission type being requested */
  permission?: string;
}

/**
 * Event input (from OpenCode plugin API)
 */
export interface EventInput {
  /** Event object */
  event: {
    /** Event type (e.g., "session.ended", "session.created") */
    type: string;
    /** Event properties */
    properties?: Record<string, unknown>;
  };
}

/**
 * Chat system transform output
 *
 * Used for experimental.chat.system.transform hook
 */
export interface SystemTransformOutput {
  /** Array of system messages to inject */
  system: string[];
}

/**
 * Permission check output
 *
 * Used for permission.ask hook
 */
export interface PermissionOutput {
  /** Status: "ask" (prompt user), "deny" (block), or "allow" */
  status: "ask" | "deny" | "allow";
}

/**
 * Tool execution before output
 *
 * Used for tool.execute.before hook
 */
export interface ToolBeforeOutput {
  /** Modified arguments (can be mutated) */
  args: Record<string, unknown>;
}

/**
 * Tool execution after output
 *
 * Used for tool.execute.after hook
 */
export interface ToolAfterOutput {
  /** Tool result output string */
  output?: string;
  /** Tool result title */
  title?: string;
  /** Tool result metadata */
  metadata?: unknown;
}

/**
 * PAI Hook type mapping
 *
 * Maps PAI hook events to their OpenCode equivalents
 */
export const PAI_TO_OPENCODE_HOOKS = {
  SessionStart: "experimental.chat.system.transform",
  SessionCompacting: "experimental.session.compacting",
  PreToolUse: "tool.execute.before",
  // OpenCode permissions can be observed via `event` (permission.*).
  // Blocking is enforced by throwing in `tool.execute.before`.
  PreToolUseBlock: "tool.execute.before",
  PostToolUse: "tool.execute.after",
  Stop: "event",
  SubagentStop: "tool.execute.after", // Filter for Task tool
} as const;
