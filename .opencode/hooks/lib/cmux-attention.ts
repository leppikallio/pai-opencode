import {
  clearProgress,
  clearStatus,
  notifyTargeted,
  setProgress,
  setStatus,
  triggerFlashForSession,
} from "../../plugins/pai-cc-hooks/shared/cmux-adapter";
import {
  buildDedupeKey,
  normalizeReasonShort,
  toPriority,
  type AttentionEvent,
  type AttentionEventKey,
} from "./cmux-attention-types";
import { shouldEmitAttention } from "./cmux-attention-store";

type AttentionStateToken = "QUESTION" | "WORK" | "DONE";

const FALLBACK_REASON_BY_EVENT: Record<AttentionEventKey, string> = {
  QUESTION_PENDING: "Question pending",
  QUESTION_RESOLVED: "Question resolved",
  PERMISSION_PENDING: "Permission pending",
  AGENT_BLOCKED: "Agent blocked",
  AGENT_FAILED: "Agent failed",
  AGENT_COMPLETED: "Agent completed",
};

const SUBTITLE_BY_EVENT: Record<AttentionEventKey, string> = {
  QUESTION_PENDING: "Question",
  QUESTION_RESOLVED: "Question",
  PERMISSION_PENDING: "Permission",
  AGENT_BLOCKED: "Blocked",
  AGENT_FAILED: "Failed",
  AGENT_COMPLETED: "Completed",
};

const ATTENTION_DEDUPE_WINDOW_MS = 2_000;
const DISABLED_FLAG_VALUES = new Set(["0", "false", "off", "no"]);

function isFeatureEnabled(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return true;
  }

  return !DISABLED_FLAG_VALUES.has(value);
}

function isAttentionEnabled(): boolean {
  return isFeatureEnabled("PAI_CMUX_ATTENTION_ENABLED");
}

function isProgressMirrorEnabled(): boolean {
  return isFeatureEnabled("PAI_CMUX_PROGRESS_ENABLED");
}

function isFlashOnP0Enabled(): boolean {
  return isFeatureEnabled("PAI_CMUX_FLASH_ON_P0");
}

function toStateToken(eventKey: AttentionEventKey): AttentionStateToken {
  switch (eventKey) {
    case "QUESTION_PENDING":
    case "PERMISSION_PENDING":
      return "QUESTION";
    case "QUESTION_RESOLVED":
    case "AGENT_COMPLETED":
      return "DONE";
    case "AGENT_BLOCKED":
    case "AGENT_FAILED":
      return "WORK";
  }
}

function toNotificationBody(event: AttentionEvent): string {
  const reasonShort = normalizeReasonShort(event.reasonShort);
  return reasonShort || FALLBACK_REASON_BY_EVENT[event.eventKey];
}

function toNotificationPayload(event: AttentionEvent): {
  title: string;
  subtitle: string;
  body: string;
} {
  return {
    title: "PAI",
    subtitle: `${SUBTITLE_BY_EVENT[event.eventKey]} ${toPriority(event.eventKey)}`,
    body: toNotificationBody(event),
  };
}

async function shouldEmit(event: AttentionEvent): Promise<boolean> {
  return shouldEmitAttention({
    dedupeKey: buildDedupeKey(event),
    nowMs: Date.now(),
    windowMs: ATTENTION_DEDUPE_WINDOW_MS,
  });
}

async function mirrorInterruptFallback(event: AttentionEvent): Promise<void> {
  const stateToken = toStateToken(event.eventKey);

  await setStatus({ key: "oc_attention", value: stateToken, sessionId: event.sessionId });
  await setStatus({ key: "oc_phase", value: stateToken, sessionId: event.sessionId });

  if (!isProgressMirrorEnabled()) {
    return;
  }

  await setProgress({ value: 1, label: stateToken, sessionId: event.sessionId });
}

export async function emitInterrupt(event: AttentionEvent): Promise<void> {
  try {
    if (!isAttentionEnabled()) {
      return;
    }

    if (!(await shouldEmit(event))) {
      return;
    }

    const payload = toNotificationPayload(event);
    await notifyTargeted({
      sessionId: event.sessionId,
      title: payload.title,
      subtitle: payload.subtitle,
      body: payload.body,
    });

    if (toPriority(event.eventKey) === "P0" && isFlashOnP0Enabled()) {
      await triggerFlashForSession({ sessionId: event.sessionId });
    }

    await mirrorInterruptFallback(event);
  } catch {
    // Best effort only.
  }
}

export async function resolveInterrupt(event: AttentionEvent): Promise<void> {
  try {
    if (!isAttentionEnabled()) {
      return;
    }

    const payload = toNotificationPayload(event);
    await notifyTargeted({
      sessionId: event.sessionId,
      title: payload.title,
      subtitle: payload.subtitle,
      body: payload.body,
    });

    await clearStatus({ key: "oc_attention", sessionId: event.sessionId });
    await setStatus({ key: "oc_phase", value: "DONE", sessionId: event.sessionId });

    if (isProgressMirrorEnabled()) {
      await clearProgress({ sessionId: event.sessionId });
    }
  } catch {
    // Best effort only.
  }
}

export async function emitAmbient(event: AttentionEvent): Promise<void> {
  try {
    if (!isAttentionEnabled()) {
      return;
    }

    if (!(await shouldEmit(event))) {
      return;
    }

    const payload = toNotificationPayload(event);
    await notifyTargeted({
      sessionId: event.sessionId,
      title: payload.title,
      subtitle: payload.subtitle,
      body: payload.body,
    });

    const stateToken = toStateToken(event.eventKey);
    await setStatus({ key: "oc_phase", value: stateToken, sessionId: event.sessionId });

    if (!isProgressMirrorEnabled()) {
      return;
    }

    await setProgress({
      value: stateToken === "DONE" ? 1 : 0.6,
      label: stateToken,
      sessionId: event.sessionId,
    });
  } catch {
    // Best effort only.
  }
}
