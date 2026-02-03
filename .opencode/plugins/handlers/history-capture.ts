/**
 * History + ISC Capture (OpenCode event-driven)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileLogError } from "../lib/file-logger";
import {
  ensureDir,
  getCurrentWorkPathForSession,
  getRawDir,
  getYearMonth,
} from "../lib/paths";
import {
  appendToThreadForSession,
  applyIscUpdateForSession,
  createWorkSession,
  getOrLoadCurrentSession,
  pauseWorkSessionForSession,
  resumeWorkSessionForSession,
  completeWorkSession,
  type IscState,
  type IscCriterion,
} from "./work-tracker";
import { parseIscResponse, type ParsedIsc } from "./isc-parser";
import { captureRating, detectRating } from "./rating-capture";
import { extractLearningsFromWork } from "./learning-capture";
import { getPermissionRequestId, getSessionStatusType, type UnknownRecord as NormRecord } from "../lib/event-normalize";
import { classifyFormatHint, type FormatHint } from "./format-reminder";
import { classifyPromptHint, type PromptHint } from "./prompt-hints";
import { maybeCaptureImplicitSentiment } from "./sentiment-capture";
import { captureRelationshipMemory } from "./relationship-memory";
import { captureSoulEvolution } from "./soul-evolution";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getStringProp(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function getRecordProp(obj: unknown, key: string): UnknownRecord | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return isRecord(v) ? v : undefined;
}

function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function hashShort(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

const MAX_TEXT = 20000;
const MAX_TOOL_OUTPUT = 20000;
const RAW_ROTATE_BYTES = 10 * 1024 * 1024;
const FORMAT_HINTS_ROTATE_BYTES = 1 * 1024 * 1024;
const PROMPT_HINTS_ROTATE_BYTES = 1 * 1024 * 1024;
const COMMIT_DEBOUNCE_MS = 250;
const SOFT_FINALIZE_MS = 30 * 60 * 1000;

class LruSet {
  private limit: number;
  private map: Map<string, true>;

  constructor(limit: number) {
    this.limit = limit;
    this.map = new Map();
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  add(key: string) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, true);
    if (this.map.size > this.limit) {
      const first = this.map.keys().next().value as string | undefined;
      if (first) this.map.delete(first);
    }
  }
}

type MessageMeta = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "unknown";
  updatedAt: number;
};

type SessionState = {
  messageMeta: Map<string, MessageMeta>;
  messageText: Map<string, string>;
  committedMessages: Set<string>;
  lastAssistantMessageId?: string;
  lastCommittedAssistantId?: string;
  toolCallToMessage: Map<string, string>;
  toolArgsByCallId: Map<string, Record<string, unknown>>;
  idleTimer?: ReturnType<typeof setTimeout> | null;
  softTimer?: ReturnType<typeof setTimeout> | null;
  idleAt?: number;
  lastActivityAt: number;
  paused?: boolean;

  pendingFormatHint?: FormatHint;
  pendingPromptHint?: PromptHint;

  lastLongHorizonCaptureAt?: number;
};

const sessions = new Map<string, SessionState>();
const dedup = new LruSet(4096);
const ignoredSessions = new Set<string>();

function getSessionState(sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = {
      messageMeta: new Map(),
      messageText: new Map(),
      committedMessages: new Set(),
      toolCallToMessage: new Map(),
      toolArgsByCallId: new Map(),
      lastActivityAt: Date.now(),
      idleTimer: null,
      softTimer: null,
    };
    sessions.set(sessionId, state);
  }
  return state;
}

async function appendJsonlWithRotation(filePath: string, line: string, maxBytes: number) {
  try {
    const dir = path.dirname(filePath);
    await ensureDir(dir);
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > maxBytes) {
        const rotated = filePath.replace(/\.jsonl$/, `.${Date.now()}.jsonl`);
        await fs.promises.rename(filePath, rotated);
      }
    } catch {
      // ignore
    }
    await fs.promises.appendFile(filePath, line);
  } catch (error) {
    fileLogError("Failed to append JSONL", error);
  }
}

async function appendRawEvent(
  sessionId: string,
  eventId: string,
  kind: string,
  name: string,
  payload: UnknownRecord
) {
  if (dedup.has(eventId)) return;
  dedup.add(eventId);

  const record = {
    v: "0.1",
    id: eventId,
    ts: new Date().toISOString(),
    sessionId,
    kind,
    name,
    payload,
    hash: hashShort(`${eventId}:${JSON.stringify(payload)}`),
  };

  const monthDir = path.join(getRawDir(), getYearMonth());
  const filePath = path.join(monthDir, `${sessionId}.jsonl`);
  const line = `${JSON.stringify(record)}\n`;
  await appendJsonlWithRotation(filePath, line, RAW_ROTATE_BYTES);
}

type CarrierClient = {
  session?: {
    create?: (options?: unknown) => Promise<unknown>;
    prompt?: (options: unknown) => Promise<unknown>;
    delete?: (options: unknown) => Promise<unknown>;
    messages?: (options?: unknown) => Promise<unknown>;
  };
};

type CarrierContext = {
  serverUrl: string;
  client?: CarrierClient;
  directory?: string;
};

async function commitUserMessage(sessionId: string, messageId: string, carrier: CarrierContext) {
  const state = getSessionState(sessionId);
  if (state.committedMessages.has(messageId)) return;

  const meta = state.messageMeta.get(messageId);
  const text = state.messageText.get(messageId);
  if (!meta || meta.role !== "user" || !text) return;

  // Mark committed early to avoid concurrent double-commit races
  // between message.updated and message.part.updated.
  state.committedMessages.add(messageId);

  const capped = capText(text, MAX_TEXT);

  const session = await getOrLoadCurrentSession(sessionId);
  if (!session) {
    const createResult = await createWorkSession(sessionId, capped);
    if (!createResult.success) return;
  }

  await appendToThreadForSession(sessionId, `**User:** ${capped}`);

  // === PASS-1 PROMPT HINT (v2.5-inspired) ===
  // OpenCode cannot inject pre-response system text on the same turn.
  // This hint is still valuable as:
  // - a toast for the operator
  // - a persisted artifact for debugging
  // - an input to future compaction context if desired
  try {
    const hint = await classifyPromptHint(capped, messageId, {
      serverUrl: carrier.serverUrl,
      client: carrier.client,
      directory: carrier.directory,
      ignoreSession: (sid) => ignoredSessions.add(sid),
      unignoreSession: (sid) => ignoredSessions.delete(sid),
    });
    state.pendingPromptHint = hint;

    await appendRawEvent(
      sessionId,
      `prompt.hint:${sessionId}:${messageId}`,
      "prompt",
      "prompt.hint",
      {
        userMessageId: messageId,
        depth: hint.depth,
        reasoning_profile: hint.reasoning_profile,
        verbosity: hint.verbosity,
        capabilities: hint.capabilities,
        thinking_tools: hint.thinking_tools,
        confidence: hint.confidence,
        source: hint.source,
      }
    );

    const workPath = await getCurrentWorkPathForSession(sessionId);
    if (workPath) {
      const hintsPath = path.join(workPath, "PROMPT_HINTS.jsonl");
      await appendJsonlWithRotation(
        hintsPath,
        `${JSON.stringify(hint)}\n`,
        PROMPT_HINTS_ROTATE_BYTES
      );
    }

    await appendToThreadForSession(
      sessionId,
      `**Prompt Hint:** depth=${hint.depth} reasoning=${hint.reasoning_profile} verbosity=${hint.verbosity}`
    );
  } catch (error) {
    fileLogError("Prompt hint failed", error);
  }

  const rating = detectRating(capped);
  if (rating) {
    await captureRating(capped, "user message");
    return;
  }

  // Implicit sentiment capture (heuristic-gated; runs async)
  const assistantId = state.lastAssistantMessageId;
  const assistantContext = assistantId ? state.messageText.get(assistantId) : undefined;
  void maybeCaptureImplicitSentiment({
    sessionId,
    userMessageId: messageId,
    userText: capped,
    serverUrl: carrier.serverUrl,
    client: carrier.client,
    directory: carrier.directory,
    ignoreSession: (sid) => ignoredSessions.add(sid),
    unignoreSession: (sid) => ignoredSessions.delete(sid),
    assistantContext: assistantContext ? capText(assistantContext, 800) : undefined,
  });
}

function buildIscState(parsed: ParsedIsc, sourceEventId: string): IscState {
  const criteria: IscCriterion[] = parsed.criteria.map((c) => ({
    id: c.id,
    text: c.text,
    status: c.status,
    evidenceRefs: c.evidenceRefs,
    sourceEventIds: [sourceEventId],
  }));

  return {
    v: "0.1",
    ideal: parsed.ideal ?? "",
    criteria,
    antiCriteria: parsed.antiCriteria.map((c) => ({ id: c.id, text: c.text })),
    updatedAt: new Date().toISOString(),
  };
}

async function commitAssistantMessage(sessionId: string) {
  const state = getSessionState(sessionId);
  const messageId = state.lastAssistantMessageId;
  if (!messageId) return;
  if (state.lastCommittedAssistantId === messageId) return;

  const text = state.messageText.get(messageId);
  if (!text) return;

  const capped = capText(text, MAX_TEXT);
  const eventId = `assistant.committed:${sessionId}:${messageId}`;

  await appendRawEvent(sessionId, eventId, "assistant.committed", "assistant.committed", {
    messageId,
    length: capped.length,
  });

  await appendToThreadForSession(sessionId, `**Assistant:** ${capped}`);

  const parsed = parseIscResponse(capped);
  const iscState = buildIscState(parsed, eventId);
  await applyIscUpdateForSession(sessionId, iscState, eventId);

  if (parsed.warnings.length > 0) {
    await appendToThreadForSession(sessionId, `**ISC Warning:** ${parsed.warnings.join("; ")}`);
  }

  // === FORMAT REMINDER (v2.5-inspired) ===
  // OpenCode cannot reliably inject per-turn system reminders.
  // Instead, compute a post-turn format hint and surface it via:
  // - persisted JSONL (debuggable)
  // - optional toast in pai-unified.ts (consumes pendingFormatHint)
  // - THREAD.md annotation (no raw text added here)
  try {
    const hint = classifyFormatHint(capped, messageId);
    state.pendingFormatHint = hint;

    await appendRawEvent(
      sessionId,
      `format.hint:${sessionId}:${messageId}`,
      "format",
      "format.hint",
      {
        assistantMessageId: messageId,
        verdict: hint.verdict,
        reasons: hint.reasons,
        features: hint.features,
      }
    );

    const workPath = await getCurrentWorkPathForSession(sessionId);
    if (workPath) {
      const hintsPath = path.join(workPath, "FORMAT_HINTS.jsonl");
      await appendJsonlWithRotation(
        hintsPath,
        `${JSON.stringify(hint)}\n`,
        FORMAT_HINTS_ROTATE_BYTES
      );
    }

    if (hint.verdict !== 'ok') {
      const reasonText = hint.reasons.filter((r) => r !== 'missing_rate_line').join(', ');
      await appendToThreadForSession(
        sessionId,
        `**Format Hint:** ${hint.verdict}${reasonText ? ` (${reasonText})` : ''}`
      );
    }
  } catch (error) {
    fileLogError("Format hint failed", error);
  }

  state.lastCommittedAssistantId = messageId;
}

function clearTimers(state: SessionState) {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
  if (state.softTimer) {
    clearTimeout(state.softTimer);
    state.softTimer = null;
  }
}

async function scheduleIdleCommit(sessionId: string) {
  const state = getSessionState(sessionId);
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    void commitAssistantMessage(sessionId);
  }, COMMIT_DEBOUNCE_MS);
}

async function scheduleSoftFinalize(sessionId: string) {
  const state = getSessionState(sessionId);
  if (state.softTimer) clearTimeout(state.softTimer);
  state.softTimer = setTimeout(async () => {
    const now = Date.now();
    if (!state.idleAt) return;
    if (now - state.lastActivityAt < SOFT_FINALIZE_MS) return;
    if (state.paused) return;
    state.paused = true;
    await pauseWorkSessionForSession(sessionId);
    await extractLearningsFromWork(sessionId);
    await appendToThreadForSession(sessionId, `**Status:** PAUSED (idle > 30m)`);
  }, SOFT_FINALIZE_MS + 50);
}

async function markActive(sessionId: string) {
  const state = getSessionState(sessionId);
  state.lastActivityAt = Date.now();
  state.idleAt = undefined;
  clearTimers(state);
  if (state.paused) {
    await resumeWorkSessionForSession(sessionId);
    state.paused = false;
    await appendToThreadForSession(sessionId, `**Status:** ACTIVE (resumed)`);
  }
}

async function handleMessageUpdated(eventProps: UnknownRecord, carrier: CarrierContext) {
  const info = getRecordProp(eventProps, "info");
  if (!info) return;

  const messageId = getStringProp(info, "id");
  const sessionId = getStringProp(info, "sessionID");
  const role = (getStringProp(info, "role") ?? "unknown") as
    | "user"
    | "assistant"
    | "unknown";
  if (!messageId || !sessionId) return;

  const state = getSessionState(sessionId);
  state.messageMeta.set(messageId, {
    id: messageId,
    sessionId,
    role,
    updatedAt: Date.now(),
  });

  if (role === "assistant") state.lastAssistantMessageId = messageId;

  await appendRawEvent(sessionId, `message.updated:${sessionId}:${messageId}`, "message.meta", "message.updated", {
    messageId,
    role,
  });

  await commitUserMessage(sessionId, messageId, carrier);
}

async function handleMessagePartUpdated(eventProps: UnknownRecord, carrier: CarrierContext) {
  const part = getRecordProp(eventProps, "part");
  if (!part) return;

  const sessionId = getStringProp(part, "sessionID");
  const messageId = getStringProp(part, "messageID");
  const partType = getStringProp(part, "type");
  if (!sessionId || !messageId || !partType) return;

  const state = getSessionState(sessionId);

  if (partType === "text") {
    const text = getStringProp(part, "text");
    if (typeof text === "string") {
      state.messageText.set(messageId, capText(text, MAX_TEXT));
      await commitUserMessage(sessionId, messageId, carrier);
    }
    return;
  }

  if (partType === "tool") {
    const callId = getStringProp(part, "callID");
    if (callId) state.toolCallToMessage.set(callId, messageId);

    const stateRec = getRecordProp(part, "state");
    const status = getStringProp(stateRec, "status");
    const toolName = getStringProp(part, "tool") ?? "tool";
    if (status === "completed") {
      const output = getStringProp(stateRec, "output") ?? "";
      const summary = capText(output, MAX_TOOL_OUTPUT);
      await appendToThreadForSession(sessionId, `**Tool:** ${toolName}\n\n${summary}`);
    } else if (status === "error") {
      const error = getStringProp(stateRec, "error") ?? "unknown error";
      await appendToThreadForSession(
        sessionId,
        `**Tool Error:** ${toolName} — ${capText(error, 500)}`
      );
    }
  }
}

export function createHistoryCapture(opts?: { serverUrl?: string; client?: CarrierClient; directory?: string }) {
  const carrier: CarrierContext = {
    serverUrl: opts?.serverUrl || "http://localhost:4096",
    client: opts?.client,
    directory: opts?.directory,
  };

  return {
    async handleEvent(eventObj: UnknownRecord) {
      const eventType = getStringProp(eventObj, "type") ?? "";
      const props = getRecordProp(eventObj, "properties") ?? {};

      const inferredSessionId =
        getStringProp(getRecordProp(props, "info"), "sessionID") ||
        getStringProp(getRecordProp(props, "part"), "sessionID") ||
        getStringProp(props, "sessionID") ||
        "";
      if (inferredSessionId && ignoredSessions.has(inferredSessionId)) {
        return;
      }

      if (eventType.startsWith("message.")) {
        const sessionId =
          getStringProp(getRecordProp(props, "info"), "sessionID") ||
          getStringProp(getRecordProp(props, "part"), "sessionID") ||
          getStringProp(props, "sessionID") ||
          "";
        if (sessionId) await markActive(sessionId);
      }

      if (eventType === "message.updated") {
        await handleMessageUpdated(props, carrier);
        return;
      }

      if (eventType === "message.part.updated") {
        await handleMessagePartUpdated(props, carrier);
        return;
      }

      if (eventType === "message.removed") {
        const sessionId = getStringProp(props, "sessionID");
        const messageId = getStringProp(props, "messageID");
        if (sessionId && messageId) {
          await appendRawEvent(
            sessionId,
            `message.removed:${sessionId}:${messageId}`,
            "message.meta",
            "message.removed",
            { messageId }
          );
        }
        return;
      }

      if (eventType === "permission.asked") {
        const sessionId = getStringProp(props, "sessionID") ?? "";
        const requestId = getPermissionRequestId(props as NormRecord);
        if (sessionId && requestId) {
          await appendRawEvent(
            sessionId,
            `permission.asked:${sessionId}:${requestId}`,
            "permission",
            "permission.asked",
            { requestId }
          );
        }
        return;
      }

      if (eventType === "permission.replied") {
        const sessionId = getStringProp(props, "sessionID") ?? "";
        const requestId = getPermissionRequestId(props as NormRecord);
        if (sessionId && requestId) {
          await appendRawEvent(
            sessionId,
            `permission.replied:${sessionId}:${requestId}`,
            "permission",
            "permission.replied",
            { requestId, reply: getStringProp(props, "reply") ?? "" }
          );
        }
        return;
      }

      if (eventType === "session.status") {
        const sessionId = getStringProp(props, "sessionID") ?? "";
        if (!sessionId) return;
        const statusType = getSessionStatusType({ properties: props } as unknown);
        await appendRawEvent(
          sessionId,
          `session.status:${sessionId}:${statusType}`,
          "session",
          "session.status",
          { status: statusType }
        );
        if (statusType === "idle") {
          const state = getSessionState(sessionId);
          state.idleAt = Date.now();
          await scheduleIdleCommit(sessionId);
          await scheduleSoftFinalize(sessionId);
        }
        return;
      }

      if (eventType === "session.idle") {
        const sessionId = getStringProp(props, "sessionID") ?? "";
        if (!sessionId) return;
        const state = getSessionState(sessionId);
        state.idleAt = Date.now();
        await appendRawEvent(
          sessionId,
          `session.idle:${sessionId}`,
          "session",
          "session.idle",
          {}
        );
        await scheduleIdleCommit(sessionId);
        await scheduleSoftFinalize(sessionId);

        // v2.5 parity: Stop hooks are closer to "assistant finished" than "session deleted".
        // Run relationship + soul capture best-effort at idle.
        // Default-on per Petteri: disable only when explicitly set to "0".
        const enableRelationship = process.env.PAI_ENABLE_RELATIONSHIP_MEMORY !== '0';
        const enableSoul = process.env.PAI_ENABLE_SOUL_EVOLUTION !== '0';
        if (enableRelationship || enableSoul) {
          const now = Date.now();
          if (!state.lastLongHorizonCaptureAt || now - state.lastLongHorizonCaptureAt > 10_000) {
            state.lastLongHorizonCaptureAt = now;
            if (enableRelationship) {
              try {
                await captureRelationshipMemory(sessionId);
              } catch (e) {
                fileLogError('RelationshipMemory failed', e);
              }
            }
            if (enableSoul) {
              try {
                void captureSoulEvolution();
              } catch (e) {
                fileLogError('SoulEvolution failed', e);
              }
            }
          }
        }
        return;
      }

      if (eventType === "session.compacted") {
        const sessionId = getStringProp(props, "sessionID") ?? "";
        if (sessionId) {
          await appendRawEvent(
            sessionId,
            `session.compacted:${sessionId}`,
            "session",
            "session.compacted",
            {}
          );
          await scheduleIdleCommit(sessionId);
        }
        return;
      }

      if (eventType === "session.created") {
        const info = getRecordProp(props, "info");
        const sessionId = getStringProp(info, "id") ?? "";
        const title = getStringProp(info, "title") ?? "work-session";
        // Ignore internal helper sessions (carrier inference/classification).
        if (title.startsWith("[PAI INTERNAL]")) {
          if (sessionId) ignoredSessions.add(sessionId);
          return;
        }
        if (sessionId) {
          await createWorkSession(sessionId, title);
          await appendToThreadForSession(sessionId, `**Session:** CREATED (${title})`);
        }
        return;
      }

      if (eventType === "session.deleted") {
        const info = getRecordProp(props, "info");
        const sessionId = getStringProp(info, "id") ?? "";
        if (sessionId) {
          await appendRawEvent(
            sessionId,
            `session.deleted:${sessionId}`,
            "session",
            "session.deleted",
            {}
          );

          await extractLearningsFromWork(sessionId);
          await completeWorkSession(sessionId);
        }
        return;
      }
    },

    async handleToolBefore(input: { tool: string; sessionID?: string; callID?: string }, args: Record<string, unknown>) {
      const sessionId = input.sessionID ?? "";
      const callId = input.callID ?? "";
      if (sessionId) {
        await markActive(sessionId);
        if (callId) {
          getSessionState(sessionId).toolArgsByCallId.set(callId, args);
        }
        await appendRawEvent(
          sessionId,
          `tool.before:${sessionId}:${input.tool}:${callId || "no-call"}`,
          "tool.before",
          input.tool,
          { callId, argKeys: Object.keys(args).slice(0, 20) }
        );
      }
    },

    async handleToolAfter(input: { tool: string; sessionID?: string; callID?: string }, output: { title?: string; output?: string; metadata?: unknown }) {
      const sessionId = input.sessionID ?? "";
      const callId = input.callID ?? "";
      if (sessionId) {
        await appendRawEvent(
          sessionId,
          `tool.after:${sessionId}:${input.tool}:${callId || "no-call"}`,
          "tool.after",
          input.tool,
          {
            callId,
            title: output.title ?? "",
            output: capText(output.output ?? "", MAX_TOOL_OUTPUT),
          }
        );
      }
    },

    getToolArgs(sessionId: string | undefined, callId: string | undefined) {
      if (!sessionId || !callId) return undefined;
      return getSessionState(sessionId).toolArgsByCallId.get(callId);
    },

    consumeFormatHint(sessionId: string): FormatHint | undefined {
      const state = getSessionState(sessionId);
      const hint = state.pendingFormatHint;
      state.pendingFormatHint = undefined;
      return hint;
    },

    consumePromptHint(sessionId: string): PromptHint | undefined {
      const state = getSessionState(sessionId);
      const hint = state.pendingPromptHint;
      state.pendingPromptHint = undefined;
      return hint;
    },

    ignoreSession(sessionId: string) {
      ignoredSessions.add(sessionId);
    },
    unignoreSession(sessionId: string) {
      ignoredSessions.delete(sessionId);
    },
  };
}
