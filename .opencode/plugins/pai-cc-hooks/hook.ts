import { loadClaudeHookSettings, type LoadedClaudeHookSettings } from "./claude/config";
import { executePreToolUseHooks } from "./claude/pre-tool-use";
import { executePostToolUseHooks } from "./claude/post-tool-use";
import { executeUserPromptSubmitHooks } from "./claude/user-prompt-submit";
import { executeStopHooks, setStopHookActive } from "./claude/stop";

type EventHookHandler = (input: unknown) => Promise<void>;
type HookHandler = (input: unknown, output: unknown) => Promise<void>;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function getString(obj: UnknownRecord, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function getRecord(obj: UnknownRecord, key: string): UnknownRecord | undefined {
  const value = obj[key];
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;
}

function getBoolean(obj: UnknownRecord, key: string): boolean | undefined {
  const value = obj[key];
  return typeof value === "boolean" ? value : undefined;
}

let settingsPromise: Promise<LoadedClaudeHookSettings> | null = null;

function getSettingsPromise(): Promise<LoadedClaudeHookSettings> {
  if (!settingsPromise) {
    settingsPromise = loadClaudeHookSettings();
  }
  return settingsPromise as Promise<LoadedClaudeHookSettings>;
}

export function createPaiClaudeHooks({ ctx }: { ctx: unknown }): {
  event: EventHookHandler;
  "chat.message": HookHandler;
  "tool.execute.before": HookHandler;
  "tool.execute.after": HookHandler;
} {
  void ctx;

  return {
    event: async (input) => {
      const payload = asRecord(input);
      const event = getRecord(payload, "event") ?? payload;
      const eventType = getString(event, "type") ?? "";

      if (eventType !== "session.idle" && eventType !== "session.deleted") {
        return;
      }

      const { hooks: config, env } = await getSettingsPromise();
      const properties = getRecord(event, "properties") ?? {};
      const info = getRecord(properties, "info") ?? {};
      const sessionId =
        getString(properties, "sessionID") ?? getString(info, "sessionID") ?? getString(info, "id") ?? "";
      if (!sessionId) return;

      const result = await executeStopHooks(
        {
          sessionId,
          cwd: process.cwd(),
          stopHookActive: getBoolean(properties, "stopHookActive"),
        },
        config,
        undefined,
        env,
      );

      if (result.stopHookActive !== undefined) {
        setStopHookActive(sessionId, result.stopHookActive);
      }

    },

    "chat.message": async (input, output) => {
      const payload = asRecord(input);
      const out = asRecord(output);
      const { hooks: config, env } = await getSettingsPromise();

      const partsRaw = payload.parts;
      const parts = Array.isArray(partsRaw)
        ? partsRaw.filter((part): part is { type: "text" | "tool_use" | "tool_result"; text?: string } => {
            return typeof part === "object" && part !== null;
          })
        : [];

      const prompt =
        getString(payload, "prompt") ??
        parts
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => part.text ?? "")
          .join("\n");

      const sessionId = getString(payload, "sessionID") ?? getString(payload, "sessionId") ?? "";
      if (!sessionId) return;

      const result = await executeUserPromptSubmitHooks(
        {
          sessionId,
          prompt,
          parts,
          cwd: process.cwd(),
        },
        config,
        undefined,
        env,
      );

      if (result.block) {
        out.error = result.reason ?? "Blocked by UserPromptSubmit hook";
      }

      if (result.messages.length > 0) {
        out.hookMessages = result.messages;
      }
    },

    "tool.execute.before": async (input, output) => {
      const payload = asRecord(input);
      const out = asRecord(output);
      const { hooks: config, env } = await getSettingsPromise();

      const toolName = getString(payload, "tool") ?? "";
      const toolInput = getRecord(payload, "args") ?? {};
      const sessionId = getString(payload, "sessionID") ?? getString(payload, "sessionId") ?? "";

      const result = await executePreToolUseHooks(
        {
          sessionId,
          toolName,
          toolInput,
          cwd: process.cwd(),
          toolUseId: getString(payload, "callID") ?? getString(payload, "callId"),
        },
        config,
        undefined,
        env,
      );

      if (result.modifiedInput) {
        out.args = result.modifiedInput;
      }

      if (result.decision === "deny") {
        throw new Error(result.reason ?? "Blocked by PreToolUse hook");
      }

      if (result.decision === "ask") {
        out.permissionDecision = "ask";
        out.permissionReason = result.reason;
      }
    },

    "tool.execute.after": async (input, output) => {
      const payload = asRecord(input);
      const out = asRecord(output);
      const { hooks: config, env } = await getSettingsPromise();

      const toolName = getString(payload, "tool") ?? "";
      const toolInput = getRecord(payload, "args") ?? {};
      const toolOutput = asRecord(output);
      const sessionId = getString(payload, "sessionID") ?? getString(payload, "sessionId") ?? "";

      const result = await executePostToolUseHooks(
        {
          sessionId,
          toolName,
          toolInput,
          toolOutput,
          cwd: process.cwd(),
          toolUseId: getString(payload, "callID") ?? getString(payload, "callId"),
        },
        config,
        undefined,
        env,
      );

      if (result.block) {
        throw new Error(result.reason ?? "Blocked by PostToolUse hook");
      }

      if (result.additionalContext) {
        out.additionalContext = result.additionalContext;
      }
    },
  };
}
