import { loadClaudeHookSettings, type LoadedClaudeHookSettings } from "./claude/config";
import { executePreToolUseHooks } from "./claude/pre-tool-use";
import { executePostToolUseHooks } from "./claude/post-tool-use";
import { executeUserPromptSubmitHooks } from "./claude/user-prompt-submit";
import { executeStopHooks, setStopHookActive } from "./claude/stop";
import type { ClaudeHooksConfig, SessionEndInput, SessionStartInput } from "./claude/types";
import { executeHookCommand } from "./shared/execute-hook-command";
import { findMatchingHooks } from "./shared/pattern-matcher";

type EventHookHandler = (input: unknown) => Promise<void>;
type HookHandler = (input: unknown, output: unknown) => Promise<void>;
type SessionGetFn = (args: { path: { id: string } }) => Promise<unknown>;

type UnknownRecord = Record<string, unknown>;
type SessionLifecycleEventName = "SessionStart" | "SessionEnd";

const DEFAULT_HOOK_COMMAND_CONFIG = {
  forceZsh: process.platform !== "win32",
  zshPath: "/bin/zsh",
};

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

function getSessionIdFromEvent(properties: UnknownRecord, info: UnknownRecord): string {
  return (
    getString(properties, "sessionID") ??
    getString(info, "sessionID") ??
    getString(info, "id") ??
    ""
  );
}

function getParentSessionIdFromEvent(properties: UnknownRecord, info: UnknownRecord): string | undefined {
  return (
    getString(info, "parentID") ??
    getString(info, "parentId") ??
    getString(properties, "parentSessionID") ??
    getString(properties, "parentSessionId")
  );
}

function getSessionGetFromContext(ctx: unknown): SessionGetFn | undefined {
  const context = asRecord(ctx);
  const client = asRecord(context.client);
  const session = asRecord(client.session);
  const get = session.get;
  return typeof get === "function" ? (get as SessionGetFn) : undefined;
}

async function executeSessionLifecycleHooks(
  args: {
    sessionId: string;
    cwd: string;
    hookEventName: SessionLifecycleEventName;
  },
  config: ClaudeHooksConfig | null,
  settingsEnv?: Record<string, string>,
): Promise<void> {
  if (!config) {
    return;
  }

  const matchers = findMatchingHooks(config, args.hookEventName);
  if (matchers.length === 0) {
    return;
  }

  const stdinData: SessionStartInput | SessionEndInput = {
    session_id: args.sessionId,
    cwd: args.cwd,
    hook_event_name: args.hookEventName,
    hook_source: "opencode-plugin",
  };

  for (const matcher of matchers) {
    if (!matcher.hooks || matcher.hooks.length === 0) continue;

    for (const hook of matcher.hooks) {
      if (hook.type !== "command") continue;

      const result = await executeHookCommand(hook.command, JSON.stringify(stdinData), args.cwd, {
        forceZsh: DEFAULT_HOOK_COMMAND_CONFIG.forceZsh,
        zshPath: DEFAULT_HOOK_COMMAND_CONFIG.zshPath,
        env: settingsEnv,
      });

      if (result.exitCode !== 0 && process.env.PAI_CC_HOOKS_DEBUG === "1") {
        const reason = result.stderr || result.stdout || `exit code ${result.exitCode}`;
        console.warn(`[pai-cc-hooks] ${args.hookEventName} hook command failed: ${reason}`);
      }
    }
  }
}

let settingsPromise: Promise<LoadedClaudeHookSettings> | null = null;

export function __resetPaiCcHooksSettingsCacheForTests(): void {
  settingsPromise = null;
}

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
  const parentSessionIdCache = new Map<string, string | null>();
  const sessionGet = getSessionGetFromContext(ctx);

  const resolveParentSessionId = async (
    sessionId: string,
    properties: UnknownRecord = {},
    info: UnknownRecord = {},
  ): Promise<string | undefined> => {
    const parentSessionIdFromEvent = getParentSessionIdFromEvent(properties, info);
    if (parentSessionIdFromEvent) {
      parentSessionIdCache.set(sessionId, parentSessionIdFromEvent);
      return parentSessionIdFromEvent;
    }

    if (parentSessionIdCache.has(sessionId)) {
      return parentSessionIdCache.get(sessionId) ?? undefined;
    }

    if (!sessionGet) {
      return undefined;
    }

    try {
      const session = asRecord(await sessionGet({ path: { id: sessionId } }));
      const sessionInfo = getRecord(session, "info") ?? {};
      const fetchedParentSessionId = getParentSessionIdFromEvent(session, sessionInfo);
      parentSessionIdCache.set(sessionId, fetchedParentSessionId ?? null);
      return fetchedParentSessionId;
    } catch {
      return undefined;
    }
  };

  return {
    event: async (input) => {
      const payload = asRecord(input);
      const event = getRecord(payload, "event") ?? payload;
      const eventType = getString(event, "type") ?? "";

      if (eventType !== "session.created" && eventType !== "session.idle" && eventType !== "session.deleted") {
        return;
      }

      const { hooks: config, env } = await getSettingsPromise();
      const properties = getRecord(event, "properties") ?? {};
      const info = getRecord(properties, "info") ?? {};
      const sessionId = getSessionIdFromEvent(properties, info);
      if (!sessionId) return;
      const parentSessionId = await resolveParentSessionId(sessionId, properties, info);

      if (eventType === "session.created") {
        if (parentSessionId) {
          return;
        }

        await executeSessionLifecycleHooks(
          {
            sessionId,
            cwd: process.cwd(),
            hookEventName: "SessionStart",
          },
          config,
          env,
        );
        return;
      }

      if (eventType === "session.deleted") {
        if (parentSessionId) {
          parentSessionIdCache.delete(sessionId);
          return;
        }

        await executeSessionLifecycleHooks(
          {
            sessionId,
            cwd: process.cwd(),
            hookEventName: "SessionEnd",
          },
          config,
          env,
        );
        parentSessionIdCache.delete(sessionId);
        return;
      }

      const result = await executeStopHooks(
        {
          sessionId,
          parentSessionId,
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
      const parentSessionId = await resolveParentSessionId(sessionId);

      const result = await executeUserPromptSubmitHooks(
        {
          sessionId,
          parentSessionId,
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
      const toolInput = getRecord(out, "args") ?? getRecord(payload, "args") ?? {};
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
