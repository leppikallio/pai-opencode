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

type AskGateEntry = {
  confirmId: string;
  createdAt: number;
  confirmedAt?: number;
  key: string;
  reason?: string;
  hookName?: string;
  toolName?: string;
  inputLines?: string;
};

// Hook "ask" decisions can't currently trigger OpenCode's permission UI
// (PermissionNext.ask) from tool.execute.before. Instead, we block the tool and
// require an explicit user confirmation message.
const ASK_GATE_TTL_MS = 5 * 60 * 1000;
const askGateByConfirmId = new Map<string, AskGateEntry>();
const askGateByKey = new Map<string, AskGateEntry>();

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const stringify = (v: unknown): string => {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "string") return JSON.stringify(v);
    if (t === "number" || t === "boolean") return String(v);
    if (t !== "object") return JSON.stringify(String(v));

    if (Array.isArray(v)) {
      return `[${v.map((x) => stringify(x)).join(",")}]`;
    }

    const obj = v as Record<string, unknown>;
    if (seen.has(obj)) return '"[Circular]"';
    seen.add(obj);
    const keys = Object.keys(obj).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k])}`);
    return `{${entries.join(",")}}`;
  };

  return stringify(value);
}

function buildAskGateKey(args: { sessionId: string; toolName: string; toolInput: UnknownRecord }): string {
  return `${args.sessionId}:${args.toolName}:${stableStringify(args.toolInput)}`;
}

function newConfirmId(): string {
  return `pai_confirm_${Math.random().toString(36).slice(2, 10)}`;
}

function parseConfirmMessage(text: string): string | undefined {
  const trimmed = text.trim();
  const match = trimmed.match(/^(?:PAI_CONFIRM|pai_confirm)\s+([a-zA-Z0-9_-]+)$/);
  return match?.[1];
}

function pruneAskGate(now: number): void {
  for (const [id, entry] of askGateByConfirmId.entries()) {
    if (now - entry.createdAt > ASK_GATE_TTL_MS) {
      askGateByConfirmId.delete(id);
      if (askGateByKey.get(entry.key)?.confirmId === id) {
        askGateByKey.delete(entry.key);
      }
    }
  }
}

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

      // If the user explicitly confirms a pending hook ask, mark it confirmed.
      // The next retry of the same tool+args will be allowed once.
      pruneAskGate(Date.now());
      const confirmId = parseConfirmMessage(prompt);
      if (confirmId) {
        const pending = askGateByConfirmId.get(confirmId);
        if (pending && !pending.confirmedAt) {
          pending.confirmedAt = Date.now();
          askGateByConfirmId.set(confirmId, pending);
          askGateByKey.set(pending.key, pending);
        }
      }

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

      pruneAskGate(Date.now());
      if (sessionId && toolName) {
        const key = buildAskGateKey({ sessionId, toolName, toolInput });
        const existing = askGateByKey.get(key);
        if (existing?.confirmedAt && Date.now() - existing.confirmedAt < ASK_GATE_TTL_MS) {
          // One-shot allow: clear the gate for this key.
          askGateByKey.delete(key);
          askGateByConfirmId.delete(existing.confirmId);
          return;
        }
      }

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
        const confirmId = newConfirmId();
        const key = buildAskGateKey({ sessionId, toolName, toolInput });

        const entry: AskGateEntry = {
          confirmId,
          createdAt: Date.now(),
          key,
          reason: result.reason,
          hookName: result.hookName,
          toolName: result.toolName,
          inputLines: result.inputLines,
        };

        askGateByConfirmId.set(confirmId, entry);
        askGateByKey.set(key, entry);

        const reason = result.reason ? `\nReason: ${result.reason}` : "";
        const hook = result.hookName ? `\nHook: ${result.hookName}` : "";
        const tool = result.toolName ? `\nTool: ${result.toolName}` : toolName ? `\nTool: ${toolName}` : "";
        const inputLines = result.inputLines ? `\nInput:\n${result.inputLines}` : "";

        throw new Error(
          `Blocked pending confirmation (hook asked).${hook}${tool}${reason}${inputLines}\n\nTo proceed, reply exactly: PAI_CONFIRM ${confirmId}`,
        );
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
