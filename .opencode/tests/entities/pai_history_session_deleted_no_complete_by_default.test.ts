import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createHistoryCapture } from "../../plugins/handlers/history-capture";

function createTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-history-session-deleted-"));
}

function withPaiDir<T>(root: string, run: () => Promise<T>): Promise<T> {
  const previousPaiDir = process.env.PAI_DIR;
  process.env.PAI_DIR = root;

  return run().finally(() => {
    if (previousPaiDir === undefined) {
      delete process.env.PAI_DIR;
      return;
    }
    process.env.PAI_DIR = previousPaiDir;
  });
}

function writeCurrentWorkState(root: string, sessions: Record<string, { work_dir: string }>): void {
  const stateDir = path.join(root, "MEMORY", "STATE");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "current-work.json"),
    JSON.stringify(
      {
        v: "0.2",
        updated_at: new Date().toISOString(),
        sessions,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function readCurrentWorkState(root: string): { sessions: Record<string, { work_dir: string }> } {
  return JSON.parse(fs.readFileSync(path.join(root, "MEMORY", "STATE", "current-work.json"), "utf-8")) as {
    sessions: Record<string, { work_dir: string }>;
  };
}

describe("history capture session.deleted behavior", () => {
  test("keeps current-work mapping on session.deleted by default", async () => {
    const root = createTempRoot();
    const sessionId = `ses_${Date.now()}`;
    const workDir = path.join(root, "MEMORY", "WORK", "2099-01", sessionId);

    try {
      fs.mkdirSync(workDir, { recursive: true });
      writeCurrentWorkState(root, { [sessionId]: { work_dir: workDir } });

      await withPaiDir(root, async () => {
        const capture = createHistoryCapture();
        await capture.handleEvent({
          type: "session.deleted",
          properties: {
            info: { id: sessionId },
          },
        });

        const state = readCurrentWorkState(root);
        expect(state.sessions[sessionId]?.work_dir).toBe(workDir);
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
