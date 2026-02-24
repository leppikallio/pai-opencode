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

  test("markNotified prunes stale notified task ids", async () => {
    const paiDir = createTempPaiDir();
    const originalPaiDir = process.env.PAI_DIR;
    const statePath = path.join(paiDir, "MEMORY", "STATE", "background-tasks.json");

    process.env.PAI_DIR = paiDir;
    try {
      const oldTimestamp = 1_000;
      const freshTimestamp = oldTimestamp + 366 * 24 * 60 * 60 * 1_000;

      await expect(markNotified("task_old", oldTimestamp)).resolves.toBe(true);
      await expect(markNotified("task_recent", freshTimestamp)).resolves.toBe(true);

      const persisted = JSON.parse(fs.readFileSync(statePath, "utf-8")) as {
        notifiedTaskIds?: Record<string, number>;
      };
      expect(persisted.notifiedTaskIds?.task_old).toBeUndefined();
      expect(persisted.notifiedTaskIds?.task_recent).toBe(freshTimestamp);

      await expect(markNotified("task_old", freshTimestamp + 1)).resolves.toBe(true);
    } finally {
      if (originalPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = originalPaiDir;
      }
    }
  });

  test("invalid JSON state is archived before writing fresh state", async () => {
    const paiDir = createTempPaiDir();
    const originalPaiDir = process.env.PAI_DIR;
    const stateDir = path.join(paiDir, "MEMORY", "STATE");
    const statePath = path.join(stateDir, "background-tasks.json");
    const corruptPayload = "{ invalid json";

    process.env.PAI_DIR = paiDir;
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(statePath, corruptPayload, "utf-8");

      await expect(markNotified("task_after_corrupt", 1234)).resolves.toBe(true);

      const archivedNames = fs
        .readdirSync(stateDir)
        .filter((name) => name.startsWith("background-tasks.json.corrupt."));

      expect(archivedNames).toHaveLength(1);
      expect(fs.readFileSync(path.join(stateDir, archivedNames[0]), "utf-8")).toBe(corruptPayload);

      const freshState = JSON.parse(fs.readFileSync(statePath, "utf-8")) as {
        notifiedTaskIds?: Record<string, number>;
      };
      expect(freshState.notifiedTaskIds?.task_after_corrupt).toBe(1234);
    } finally {
      if (originalPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = originalPaiDir;
      }
    }
  });
});
