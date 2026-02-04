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

function parseJsonBestEffort(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function mapTodoStatusToIscStatus(statusRaw: string): string {
  const s = statusRaw.trim().toLowerCase();
  if (s === "completed" || s === "done") return "VERIFIED";
  if (s === "in_progress" || s === "in-progress" || s === "in progress") return "IN_PROGRESS";
  if (s === "cancelled" || s === "canceled") return "REMOVED";
  if (s === "failed") return "FAILED";
  return "PENDING";
}

function buildIscStateFromTodos(todos: unknown, sourceEventId: string): IscState | null {
  if (!Array.isArray(todos)) return null;

  const criteria: IscCriterion[] = [];
  for (const item of todos) {
    if (!isRecord(item)) continue;
    const text = typeof item.content === "string" ? item.content.trim() : "";
    if (!text) continue;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : hashShort(text);
    const status = typeof item.status === "string" ? mapTodoStatusToIscStatus(item.status) : "PENDING";
    criteria.push({
      id,
      text,
      status,
      sourceEventIds: [sourceEventId],
    });
  }

  // If there are no usable criteria, don't clobber ISC.json.
  if (criteria.length === 0) return null;

  return {
    v: "0.1",
    ideal: "",
    criteria,
    antiCriteria: [],
    updatedAt: new Date().toISOString(),
  };
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
const parentBySession = new Map<string, string>();
const dedup = new LruSet(4096);
const ignoredSessions = new Set<string>();

function storageSessionIdFor(sourceSessionId: string): { storage: string; isSubagent: boolean } {
  const parent = parentBySession.get(sourceSessionId);
  if (parent) return { storage: parent, isSubagent: true };
  return { storage: sourceSessionId, isSubagent: false };
}

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
  payload: UnknownRecord,
  meta?: { sourceSessionId?: string }
) {
  if (dedup.has(eventId)) return;
  dedup.add(eventId);

  const record = {
    v: "0.1",
    id: eventId,
    ts: new Date().toISOString(),
    sessionId,
    ...(meta?.sourceSessionId ? { sourceSessionId: meta.sourceSessionId } : {}),
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

  const { storage, isSubagent } = storageSessionIdFor(sessionId);
  const session = await getOrLoadCurrentSession(storage);
  if (!session) {
    const createResult = await createWorkSession(storage, capped);
    if (!createResult.success) return;
  }

  await appendToThreadForSession(storage, `${isSubagent ? `**Subagent User (${sessionId}):** ` : "**User:** "}${capped}`);

  // === PASS-1 PROMPT HINT (v2.5-inspired) ===
  // OpenCode cannot inject pre-response system text on the same turn.
  // This hint is still valuable as:
  // - a toast for the operator
  // - a persisted artifact for debugging
  // - an input to future compaction context if desired
  // Subagent sessions should be minimal: skip prompt hint, ratings, sentiment.
  if (isSubagent) return;

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
       storage,
       `prompt.hint:${storage}:${messageId}`,
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
       },
       { sourceSessionId: sessionId }
     );

     const workPath = await getCurrentWorkPathForSession(storage);
     if (workPath) {
       const hintsPath = path.join(workPath, "PROMPT_HINTS.jsonl");
      await appendJsonlWithRotation(
        hintsPath,
        `${JSON.stringify(hint)}\n`,
        PROMPT_HINTS_ROTATE_BYTES
      );
    }

     await appendToThreadForSession(
       storage,
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
    sessionId: storage,
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
  const { storage, isSubagent } = storageSessionIdFor(sessionId);
  const eventId = `assistant.committed:${storage}:${messageId}`;

  await appendRawEvent(storage, eventId, "assistant.committed", "assistant.committed", {
    messageId,
    length: capped.length,
  }, { sourceSessionId: sessionId });

  await appendToThreadForSession(storage, `${isSubagent ? `**Subagent Assistant (${sessionId}):** ` : "**Assistant:** "}${capped}`);

  const parsed = parseIscResponse(capped);
  const iscState = buildIscState(parsed, eventId);
  if (!isSubagent) {
    await applyIscUpdateForSession(storage, iscState, eventId);
  }

  if (parsed.warnings.length > 0) {
    if (!isSubagent) {
      await appendToThreadForSession(storage, `**ISC Warning:** ${parsed.warnings.join("; ")}`);
    }
  }

  // === FORMAT REMINDER (v2.5-inspired) ===
  // OpenCode cannot reliably inject per-turn system reminders.
  // Instead, compute a post-turn format hint and surface it via:
  // - persisted JSONL (debuggable)
  // - optional toast in pai-unified.ts (consumes pendingFormatHint)
  // - THREAD.md annotation (no raw text added here)
  // Subagent sessions should be minimal: skip format hint artifacts.
  if (!isSubagent) try {
    const hint = classifyFormatHint(capped, messageId);
    state.pendingFormatHint = hint;

    await appendRawEvent(
      storage,
      `format.hint:${storage}:${messageId}`,
      "format",
      "format.hint",
      {
        assistantMessageId: messageId,
        verdict: hint.verdict,
        reasons: hint.reasons,
        features: hint.features,
      },
      { sourceSessionId: sessionId }
    );

    const workPath = await getCurrentWorkPathForSession(storage);
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
        storage,
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

  const mapped = storageSessionIdFor(sessionId);
  await appendRawEvent(mapped.storage, `message.updated:${mapped.storage}:${messageId}`, "message.meta", "message.updated", {
    messageId,
    role,
  }, { sourceSessionId: sessionId });

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
      const mapped = storageSessionIdFor(sessionId);
      await appendToThreadForSession(
        mapped.storage,
        `${mapped.isSubagent ? `**Subagent Tool (${sessionId}):** ` : "**Tool:** "}${toolName}\n\n${summary}`
      );
    } else if (status === "error") {
      const error = getStringProp(stateRec, "error") ?? "unknown error";
      const mapped = storageSessionIdFor(sessionId);
      await appendToThreadForSession(
        mapped.storage,
        `${mapped.isSubagent ? `**Subagent Tool Error (${sessionId}):** ` : "**Tool Error:** "}${toolName} — ${capText(error, 500)}`
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

      // Track parent relationships to classify subagent sessions.
      if (eventType === "session.created" || eventType === "session.updated") {
        const info = getRecordProp(props, "info");
        const sid = getStringProp(info, "id");
        const parent = getStringProp(info, "parentID");
        if (sid && parent) parentBySession.set(sid, parent);
        if (sid && !parent) parentBySession.delete(sid);
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
          const mapped = storageSessionIdFor(sessionId);
          await appendRawEvent(
            mapped.storage,
            `message.removed:${mapped.storage}:${messageId}`,
            "message.meta",
            "message.removed",
            { messageId },
            { sourceSessionId: sessionId }
          );
        }
        return;
      }

      if (eventType === "permission.asked") {
        const sessionId = getStringProp(props, "sessionID") ?? "";
        const requestId = getPermissionRequestId(props as NormRecord);
        if (sessionId && requestId) {
          const mapped = storageSessionIdFor(sessionId);
          await appendRawEvent(
            mapped.storage,
            `permission.asked:${mapped.storage}:${requestId}`,
            "permission",
            "permission.asked",
            { requestId },
            { sourceSessionId: sessionId }
          );
        }
        return;
      }

      if (eventType === "permission.replied") {
        const sessionId = getStringProp(props, "sessionID") ?? "";
        const requestId = getPermissionRequestId(props as NormRecord);
        if (sessionId && requestId) {
          const mapped = storageSessionIdFor(sessionId);
          await appendRawEvent(
            mapped.storage,
            `permission.replied:${mapped.storage}:${requestId}`,
            "permission",
            "permission.replied",
            { requestId, reply: getStringProp(props, "reply") ?? "" },
            { sourceSessionId: sessionId }
          );
        }
        return;
      }

      if (eventType === "session.status") {
        const sessionId = getStringProp(props, "sessionID") ?? "";
        if (!sessionId) return;
        const statusType = getSessionStatusType({ properties: props } as unknown);
        const mapped = storageSessionIdFor(sessionId);
        await appendRawEvent(
          mapped.storage,
          `session.status:${mapped.storage}:${statusType}`,
          "session",
          "session.status",
          { status: statusType },
          { sourceSessionId: sessionId }
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
        const mapped = storageSessionIdFor(sessionId);
        await appendRawEvent(
          mapped.storage,
          `session.idle:${mapped.storage}`,
          "session",
          "session.idle",
          {},
          { sourceSessionId: sessionId }
        );
        await scheduleIdleCommit(sessionId);
        await scheduleSoftFinalize(sessionId);

        // Subagent sessions must be minimal.
        if (mapped.isSubagent) return;

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
          const mapped = storageSessionIdFor(sessionId);
          await appendRawEvent(
            mapped.storage,
            `session.compacted:${mapped.storage}`,
            "session",
            "session.compacted",
            {},
            { sourceSessionId: sessionId }
          );
          await scheduleIdleCommit(sessionId);
        }
        return;
      }

      if (eventType === "session.created") {
        const info = getRecordProp(props, "info");
        const sessionId = getStringProp(info, "id") ?? "";
        const title = getStringProp(info, "title") ?? "work-session";
        const parentId = getStringProp(info, "parentID") ?? "";
        if (sessionId && parentId) parentBySession.set(sessionId, parentId);
        // Ignore internal helper sessions (carrier inference/classification).
        if (title.startsWith("[PAI INTERNAL]")) {
          if (sessionId) ignoredSessions.add(sessionId);
          return;
        }
        if (sessionId) {
          const mapped = storageSessionIdFor(sessionId);
          await createWorkSession(mapped.storage, title);
          await appendToThreadForSession(
            mapped.storage,
            mapped.isSubagent
              ? `**Subagent Session:** CREATED (${sessionId}) (${title})`
              : `**Session:** CREATED (${title})`
          );
        }
        return;
      }

      if (eventType === "session.deleted") {
        const info = getRecordProp(props, "info");
        const sessionId = getStringProp(info, "id") ?? "";
        if (sessionId) {
          const mapped = storageSessionIdFor(sessionId);
          await appendRawEvent(
            mapped.storage,
            `session.deleted:${mapped.storage}`,
            "session",
            "session.deleted",
            {},
            { sourceSessionId: sessionId }
          );

          // Never finalize or complete work on subagent session deletion.
          if (!mapped.isSubagent) {
            await extractLearningsFromWork(sessionId);
            await completeWorkSession(sessionId);
          }
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
        const mapped = storageSessionIdFor(sessionId);
        await appendRawEvent(
          mapped.storage,
          `tool.before:${mapped.storage}:${input.tool}:${callId || "no-call"}`,
          "tool.before",
          input.tool,
          { callId, argKeys: Object.keys(args).slice(0, 20) },
          { sourceSessionId: sessionId }
        );
      }
    },

    async handleToolAfter(input: { tool: string; sessionID?: string; callID?: string }, output: { title?: string; output?: string; metadata?: unknown }) {
      const sessionId = input.sessionID ?? "";
      const callId = input.callID ?? "";
      if (sessionId) {
        const mapped = storageSessionIdFor(sessionId);
        const eventId = `tool.after:${mapped.storage}:${input.tool}:${callId || "no-call"}`;

        await appendRawEvent(
          mapped.storage,
          eventId,
          "tool.after",
          input.tool,
          {
            callId,
            title: output.title ?? "",
            output: capText(output.output ?? "", MAX_TOOL_OUTPUT),
          },
          { sourceSessionId: sessionId }
        );

        // ISC persistence fix: if the assistant used todowrite, persist criteria into ISC.json
        // from tool args (preferred) or tool output (fallback), instead of relying on response text parsing.
        if (!mapped.isSubagent && input.tool === "todowrite") {
          try {
            // Ensure work session exists (tool calls can happen before session.created event).
            const existing = await getCurrentWorkPathForSession(mapped.storage);
            if (!existing) {
              await createWorkSession(mapped.storage, "todowrite");
            }

            const state = getSessionState(sessionId);
            const args = callId ? state.toolArgsByCallId.get(callId) : undefined;
            const todosFromArgs = args && isRecord(args) ? (args as UnknownRecord).todos : undefined;
            const todosFromOutput = typeof output.output === "string" ? parseJsonBestEffort(output.output) : undefined;

            const iscFromTodos =
              buildIscStateFromTodos(todosFromArgs, eventId) ??
              buildIscStateFromTodos(todosFromOutput, eventId);

            if (iscFromTodos) {
              await applyIscUpdateForSession(mapped.storage, iscFromTodos, eventId);
              await appendToThreadForSession(mapped.storage, `**ISC:** persisted from todowrite (${iscFromTodos.criteria.length} criteria)`);
            }
          } catch (error) {
            fileLogError("Failed to persist ISC from todowrite", error);
          }
        }

        // Avoid unbounded in-memory growth.
        if (callId) {
          getSessionState(sessionId).toolArgsByCallId.delete(callId);
        }
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
