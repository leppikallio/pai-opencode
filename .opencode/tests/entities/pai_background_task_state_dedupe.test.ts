import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  markNotified,
  shouldSuppressDuplicate,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";

function createTempPaiDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-task-state-"));
}

describe("background task state dedupe", () => {
  test("markNotified prevents notifying same task id twice", async () => {
    const paiDir = createTempPaiDir();
    const originalPaiDir = process.env.PAI_DIR;

    process.env.PAI_DIR = paiDir;
    try {
      await expect(markNotified("task_123")).resolves.toBe(true);
      await expect(markNotified("task_123")).resolves.toBe(false);
    } finally {
      if (originalPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = originalPaiDir;
      }
    }
  });

  test("shouldSuppressDuplicate is true for same session/title/body within 2000ms", async () => {
    const paiDir = createTempPaiDir();
    const originalPaiDir = process.env.PAI_DIR;

    process.env.PAI_DIR = paiDir;
    try {
      const first = await shouldSuppressDuplicate({
        sessionId: "ses_123",
        title: "Task finished",
        body: "Done",
        nowMs: 1_000,
      });
      expect(first).toBe(false);

      const second = await shouldSuppressDuplicate({
        sessionId: "ses_123",
        title: "Task finished",
        body: "Done",
        nowMs: 2_500,
      });
      expect(second).toBe(true);

      const third = await shouldSuppressDuplicate({
        sessionId: "ses_123",
        title: "Task finished",
        body: "Done",
        nowMs: 4_700,
      });
      expect(third).toBe(false);
    } finally {
      if (originalPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = originalPaiDir;
      }
    }
  });
});
