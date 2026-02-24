import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  markNotified,
  recordBackgroundTaskLaunch,
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

  test("markNotified enforces notifiedTaskIds size cap by pruning oldest entries", async () => {
    const paiDir = createTempPaiDir();
    const originalPaiDir = process.env.PAI_DIR;
    const stateDir = path.join(paiDir, "MEMORY", "STATE");
    const statePath = path.join(stateDir, "background-tasks.json");
    const nowMs = 10_000;

    process.env.PAI_DIR = paiDir;
    try {
      fs.mkdirSync(stateDir, { recursive: true });

      const notifiedTaskIds: Record<string, number> = {};
      for (let idx = 0; idx < 2_005; idx += 1) {
        notifiedTaskIds[`task_${String(idx).padStart(4, "0")}`] = 1_000 + idx;
      }

      fs.writeFileSync(
        statePath,
        JSON.stringify(
          {
            version: 1,
            updatedAtMs: 1_000,
            notifiedTaskIds,
            duplicateBySession: {},
          },
          null,
          2,
        ) + "\n",
        "utf-8",
      );

      await expect(markNotified("extra", nowMs)).resolves.toBe(true);

      const persisted = JSON.parse(fs.readFileSync(statePath, "utf-8")) as {
        notifiedTaskIds?: Record<string, number>;
      };
      const keys = Object.keys(persisted.notifiedTaskIds ?? {});
      expect(keys.length).toBe(2_000);
      expect(persisted.notifiedTaskIds?.extra).toBe(nowMs);

      expect(persisted.notifiedTaskIds?.task_0000).toBeUndefined();
      expect(persisted.notifiedTaskIds?.task_0001).toBeUndefined();
      expect(persisted.notifiedTaskIds?.task_0005).toBeUndefined();
      expect(persisted.notifiedTaskIds?.task_0006).toBe(1_006);
      expect(persisted.notifiedTaskIds?.task_2004).toBe(3_004);
    } finally {
      if (originalPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = originalPaiDir;
      }
    }
  });

  test("markNotified evicts stale lock and succeeds", async () => {
    const paiDir = createTempPaiDir();
    const originalPaiDir = process.env.PAI_DIR;
    const stateDir = path.join(paiDir, "MEMORY", "STATE");
    const statePath = path.join(stateDir, "background-tasks.json");
    const lockPath = `${statePath}.lock`;

    process.env.PAI_DIR = paiDir;
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ ownerId: "stale-owner", createdAt: Date.now() - 60_000 }) + "\n",
        "utf-8",
      );

      await expect(markNotified("x", 123)).resolves.toBe(true);

      const staleArtifacts = fs
        .readdirSync(stateDir)
        .filter((name) => name.startsWith("background-tasks.json.lock.stale."));
      expect(staleArtifacts.length).toBeGreaterThanOrEqual(1);

      const persisted = JSON.parse(fs.readFileSync(statePath, "utf-8")) as {
        notifiedTaskIds?: Record<string, number>;
      };
      expect(persisted.notifiedTaskIds?.x).toBe(123);
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      if (originalPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = originalPaiDir;
      }
    }
  });

  test("recordBackgroundTaskLaunch prunes stale backgroundTasks by TTL", async () => {
    const paiDir = createTempPaiDir();
    const originalPaiDir = process.env.PAI_DIR;
    const stateDir = path.join(paiDir, "MEMORY", "STATE");
    const statePath = path.join(stateDir, "background-tasks.json");

    process.env.PAI_DIR = paiDir;
    try {
      fs.mkdirSync(stateDir, { recursive: true });

      const nowMs = 8 * 24 * 60 * 60 * 1_000;
      fs.writeFileSync(
        statePath,
        JSON.stringify(
          {
            version: 1,
            updatedAtMs: 1_000,
            notifiedTaskIds: {},
            duplicateBySession: {},
            backgroundTasks: {
              task_old: {
                task_id: "task_old",
                child_session_id: "child_old",
                parent_session_id: "parent_old",
                launched_at_ms: 1_000,
                updated_at_ms: 1_000,
              },
              task_recent: {
                task_id: "task_recent",
                child_session_id: "child_recent",
                parent_session_id: "parent_recent",
                launched_at_ms: nowMs - 100,
                updated_at_ms: nowMs - 100,
              },
            },
          },
          null,
          2,
        ) + "\n",
        "utf-8",
      );

      await recordBackgroundTaskLaunch({
        taskId: "task_new",
        childSessionId: "child_new",
        parentSessionId: "parent_new",
        nowMs,
      });

      const persisted = JSON.parse(fs.readFileSync(statePath, "utf-8")) as {
        backgroundTasks?: Record<string, unknown>;
      };
      const backgroundTaskIds = Object.keys(persisted.backgroundTasks ?? {});

      expect(backgroundTaskIds).not.toContain("task_old");
      expect(backgroundTaskIds).toContain("task_recent");
      expect(backgroundTaskIds).toContain("task_new");
    } finally {
      if (originalPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = originalPaiDir;
      }
    }
  });

  test("recordBackgroundTaskLaunch enforces backgroundTasks size cap", async () => {
    const paiDir = createTempPaiDir();
    const originalPaiDir = process.env.PAI_DIR;
    const stateDir = path.join(paiDir, "MEMORY", "STATE");
    const statePath = path.join(stateDir, "background-tasks.json");
    const nowMs = 10_000;

    process.env.PAI_DIR = paiDir;
    try {
      fs.mkdirSync(stateDir, { recursive: true });

      const backgroundTasks: Record<string, unknown> = {};
      for (let idx = 0; idx < 2_005; idx += 1) {
        const taskId = `task_${String(idx).padStart(4, "0")}`;
        const atMs = 1_000 + idx;
        backgroundTasks[taskId] = {
          task_id: taskId,
          child_session_id: `child_${taskId}`,
          parent_session_id: `parent_${taskId}`,
          launched_at_ms: atMs,
          updated_at_ms: atMs,
        };
      }

      fs.writeFileSync(
        statePath,
        JSON.stringify(
          {
            version: 1,
            updatedAtMs: 1_000,
            notifiedTaskIds: {},
            duplicateBySession: {},
            backgroundTasks,
          },
          null,
          2,
        ) + "\n",
        "utf-8",
      );

      await recordBackgroundTaskLaunch({
        taskId: "extra",
        childSessionId: "child_extra",
        parentSessionId: "parent_extra",
        nowMs,
      });

      const persisted = JSON.parse(fs.readFileSync(statePath, "utf-8")) as {
        backgroundTasks?: Record<string, unknown>;
      };
      const backgroundTaskIds = Object.keys(persisted.backgroundTasks ?? {});

      expect(backgroundTaskIds.length).toBe(2_000);
      expect(backgroundTaskIds).toContain("extra");
      expect(backgroundTaskIds).not.toContain("task_0000");
      expect(backgroundTaskIds).not.toContain("task_0001");
      expect(backgroundTaskIds).not.toContain("task_0005");
      expect(backgroundTaskIds).toContain("task_0006");
      expect(backgroundTaskIds).toContain("task_2004");
    } finally {
      if (originalPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = originalPaiDir;
      }
    }
  });
});
