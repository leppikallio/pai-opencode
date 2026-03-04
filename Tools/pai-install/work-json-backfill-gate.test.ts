import { describe, expect, test } from "bun:test";

import { decideWorkJsonBackfill, type WorkJsonBackfillGateInput } from "./work-json-backfill-gate";

describe("decideWorkJsonBackfill", () => {
  const cases: Array<{
    name: string;
    input: WorkJsonBackfillGateInput;
    shouldRun: boolean;
    reason: string;
  }> = [
    {
      name: "runs when work.json is missing",
      input: { state: "missing" },
      shouldRun: true,
      reason: "work.json missing",
    },
    {
      name: "runs when work.json is unreadable",
      input: { state: "unreadable" },
      shouldRun: true,
      reason: "work.json unreadable",
    },
    {
      name: "runs when path is not a file",
      input: { state: "not-file" },
      shouldRun: true,
      reason: "work.json not a file",
    },
    {
      name: "runs when file is empty",
      input: { state: "file", sizeBytes: 0, content: "" },
      shouldRun: true,
      reason: "work.json empty",
    },
    {
      name: "runs when JSON parsing fails",
      input: { state: "file", sizeBytes: 12, content: "{invalid-json" },
      shouldRun: true,
      reason: "work.json parse failed",
    },
    {
      name: "runs when sessions object is missing",
      input: {
        state: "file",
        sizeBytes: 2,
        content: JSON.stringify({}),
      },
      shouldRun: true,
      reason: "sessions missing",
    },
    {
      name: "runs when sessions object is empty",
      input: {
        state: "file",
        sizeBytes: 20,
        content: JSON.stringify({ sessions: {} }),
      },
      shouldRun: true,
      reason: "sessions empty",
    },
    {
      name: "runs when any session entry misses prdPath",
      input: {
        state: "file",
        sizeBytes: 80,
        content: JSON.stringify({
          sessions: {
            migrated: { prdPath: "MEMORY/WORK/one/PRD.md" },
            legacy: { started: "2026-03-04T09:00:00.000Z" },
          },
        }),
      },
      shouldRun: true,
      reason: "sessions missing prdPath",
    },
    {
      name: "skips when all session entries have prdPath",
      input: {
        state: "file",
        sizeBytes: 90,
        content: JSON.stringify({
          sessions: {
            first: { prdPath: "MEMORY/WORK/a/PRD.md" },
            second: { prdPath: "MEMORY/WORK/b/PRD.md" },
          },
        }),
      },
      shouldRun: false,
      reason: "all sessions have prdPath",
    },
  ];

  for (const testCase of cases) {
    test(testCase.name, () => {
      const decision = decideWorkJsonBackfill(testCase.input);
      expect(decision).toEqual({
        shouldRun: testCase.shouldRun,
        reason: testCase.reason,
      });
    });
  }
});
