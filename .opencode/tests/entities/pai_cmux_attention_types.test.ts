import { describe, expect, test } from "bun:test";

import {
  buildDedupeKey,
  normalizeReasonShort,
  toPriority,
  type AttentionEvent,
  type AttentionEventKey,
} from "../../hooks/lib/cmux-attention-types";

describe("cmux attention types", () => {
  test("maps all attention event keys to priorities", () => {
    const cases: Array<[AttentionEventKey, "P0" | "P1" | "P2"]> = [
      ["QUESTION_PENDING", "P0"],
      ["QUESTION_RESOLVED", "P2"],
      ["PERMISSION_PENDING", "P0"],
      ["AGENT_BLOCKED", "P0"],
      ["AGENT_FAILED", "P1"],
      ["AGENT_COMPLETED", "P2"],
    ];

    for (const [eventKey, expectedPriority] of cases) {
      expect(toPriority(eventKey)).toBe(expectedPriority);
    }
  });

  test("normalizes short reasons", () => {
    expect(normalizeReasonShort("  Need   deploy   approval   ")).toBe("Need deploy approval");
  });

  test("normalizes null reason to empty string", () => {
    expect(normalizeReasonShort(null)).toBe("");
  });

  test("normalizes undefined reason to empty string", () => {
    expect(normalizeReasonShort(undefined)).toBe("");
  });

  test("caps normalized reason length at sixty characters", () => {
    const normalized = normalizeReasonShort(
      "This reason is intentionally long so it should be clipped for panel readability",
    );

    expect(normalized).toHaveLength(60);
    expect(normalized).toBe("This reason is intentionally long so it should be clipped fo");
  });

  test("builds deterministic dedupe keys from normalized tuple values", () => {
    const event: AttentionEvent = {
      eventKey: "QUESTION_PENDING",
      sessionId: "  ses_123  ",
      reasonShort: "  Need   deploy   approval   ",
    };

    expect(buildDedupeKey(event)).toBe('["QUESTION_PENDING","ses_123","Need deploy approval"]');
  });

  test("avoids collisions from delimiter-based dedupe serialization", () => {
    const sessionWithDelimiter: AttentionEvent = {
      eventKey: "QUESTION_PENDING",
      sessionId: "ses|123",
      reasonShort: "approval",
    };
    const reasonWithDelimiter: AttentionEvent = {
      eventKey: "QUESTION_PENDING",
      sessionId: "ses",
      reasonShort: "123|approval",
    };

    const legacyDedupeKey = (event: AttentionEvent): string =>
      [event.eventKey, event.sessionId.trim(), normalizeReasonShort(event.reasonShort)].join("|");

    expect(legacyDedupeKey(sessionWithDelimiter)).toBe(legacyDedupeKey(reasonWithDelimiter));
    expect(buildDedupeKey(sessionWithDelimiter)).not.toBe(buildDedupeKey(reasonWithDelimiter));
  });
});
