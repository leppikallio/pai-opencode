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
  /** Working directory context */
  cwd?: string;
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
 * Compaction continuation bundle schema identifier
 */
export const PAI_COMPACTION_CONTINUATION_BUNDLE_SCHEMA =
  "pai.compaction.continuation.bundle.v1" as const;

/**
 * Derived continuity state schema identifier
 */
export const PAI_COMPACTION_DERIVED_CONTINUITY_SCHEMA =
  "pai.compaction.derived.continuity.v1" as const;

/**
 * Work pointer included in compaction continuation bundle
 */
export interface PaiCompactionSessionWorkPointer {
  sessionId: string;
  workDir: string;
  isParent: boolean;
}

/**
 * Next unfinished ISC criterion hint
 */
export interface PaiCompactionIscCriterionHint {
  id: string;
  text: string;
  status: string;
}

/**
 * ISC progress summary in continuation bundle
 */
export interface PaiCompactionIscProgressSummary {
  total: number;
  verified: number;
  pending: number;
  failed: number;
  nextUnfinished: PaiCompactionIscCriterionHint[];
}

/**
 * Active delegated child-session summary
 */
export interface PaiCompactionBackgroundTaskHint {
  taskId: string;
  childSessionId: string;
  status: string;
  taskDescription?: string;
}

/**
 * Compact delegated-session lineage item
 */
export interface PaiCompactionLineageItem {
  taskId: string;
  childSessionId: string;
  status: string;
  launchedAtMs: number;
  updatedAtMs: number;
}

/**
 * Delegated-session lineage summary in continuation bundle
 */
export interface PaiCompactionLineageSummary {
  totalDelegated: number;
  activeDelegated: number;
  terminalDelegated: number;
  statusCounts: Record<string, number>;
  recent: PaiCompactionLineageItem[];
}

/**
 * Compaction continuation bundle generated from existing PAI artifacts
 */
export interface PaiCompactionContinuationBundleV1 {
  schema: typeof PAI_COMPACTION_CONTINUATION_BUNDLE_SCHEMA;
  generatedAt: string;
  selection: {
    parentSessionId: string;
    referencedChildSessionIds: string[];
    includedSessionIds: string[];
    rule: "parent-plus-referenced-children";
  };
  currentWork: {
    activeSlug?: string;
    currentPointer?: string;
    pointers: PaiCompactionSessionWorkPointer[];
  };
  progress: {
    prdProgress?: string;
    prdPhase?: string;
    isc: PaiCompactionIscProgressSummary;
  };
  background: {
    activeChildSessions: PaiCompactionBackgroundTaskHint[];
    pendingTaskIds: string[];
    lineage: PaiCompactionLineageSummary;
  };
  continuationHints: string[];
  budgets: {
    maxBytes: number;
    maxLines: number;
  };
}

/**
 * Derived continuity state restored after compaction, sourced from artifacts
 */
export interface PaiCompactionDerivedContinuityStateV1 {
  schema: typeof PAI_COMPACTION_DERIVED_CONTINUITY_SCHEMA;
  updatedAt: string;
  workPath?: string;
  activeWorkSlug?: string;
  prdProgress?: string;
  prdPhase?: string;
  nextUnfinishedIscIds: string[];
  nextUnfinishedIscTexts: string[];
  activeBackgroundTaskIds: string[];
  continuationHints: string[];
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
