export type AttentionEventKey =
  | "QUESTION_PENDING"
  | "QUESTION_RESOLVED"
  | "PERMISSION_PENDING"
  | "AGENT_BLOCKED"
  | "AGENT_FAILED"
  | "AGENT_COMPLETED";

export type AttentionPriority = "P0" | "P1" | "P2";

export interface AttentionEvent {
  eventKey: AttentionEventKey;
  sessionId: string;
  reasonShort?: string | null;
}

const MAX_REASON_SHORT_LENGTH = 60;

const PRIORITY_BY_EVENT_KEY: Record<AttentionEventKey, AttentionPriority> = {
  QUESTION_PENDING: "P0",
  QUESTION_RESOLVED: "P2",
  PERMISSION_PENDING: "P0",
  AGENT_BLOCKED: "P0",
  AGENT_FAILED: "P1",
  AGENT_COMPLETED: "P2",
};

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function toPriority(eventKey: AttentionEventKey): AttentionPriority {
  return PRIORITY_BY_EVENT_KEY[eventKey];
}

export function normalizeReasonShort(input: string | null | undefined): string {
  return collapseWhitespace(input ?? "").slice(0, MAX_REASON_SHORT_LENGTH);
}

export function buildDedupeKey(event: AttentionEvent): string {
  return JSON.stringify([
    event.eventKey,
    event.sessionId.trim(),
    normalizeReasonShort(event.reasonShort),
  ] as const);
}
