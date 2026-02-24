import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getConversationTextFromThread } from "../../plugins/pai-cc-hooks/shared/thread-projections";

function createTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-thread-"));
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

describe("thread projections", () => {
  test("reads THREAD.md via current-work.json mapping", async () => {
    const root = createTempRoot();
    const workDir = path.join(root, "MEMORY", "WORK", "2099-01", "ses_abc");
    fs.mkdirSync(workDir, { recursive: true });

    writeCurrentWorkState(root, { ses_abc: { work_dir: workDir } });
    fs.writeFileSync(path.join(workDir, "THREAD.md"), "# Title\n\nhello\n", "utf-8");

    await withPaiDir(root, async () => {
      const text = await getConversationTextFromThread({ sessionId: "ses_abc", maxChars: 1000 });
      expect(text).toContain("hello");
    });
  });

  test("returns empty string when session mapping is missing", async () => {
    const root = createTempRoot();
    writeCurrentWorkState(root, {});

    await withPaiDir(root, async () => {
      const text = await getConversationTextFromThread({ sessionId: "ses_missing", maxChars: 1000 });
      expect(text).toBe("");
    });
  });

  test("returns empty string when THREAD.md is missing", async () => {
    const root = createTempRoot();
    const workDir = path.join(root, "MEMORY", "WORK", "2099-01", "ses_no_thread");
    fs.mkdirSync(workDir, { recursive: true });
    writeCurrentWorkState(root, { ses_no_thread: { work_dir: workDir } });

    await withPaiDir(root, async () => {
      const text = await getConversationTextFromThread({ sessionId: "ses_no_thread", maxChars: 1000 });
      expect(text).toBe("");
    });
  });

  test("returns whole emoji for maxChars=1 (no lone surrogate)", async () => {
    const root = createTempRoot();
    const workDir = path.join(root, "MEMORY", "WORK", "2099-01", "ses_emoji");
    fs.mkdirSync(workDir, { recursive: true });
    writeCurrentWorkState(root, { ses_emoji: { work_dir: workDir } });
    fs.writeFileSync(path.join(workDir, "THREAD.md"), "A🙂", "utf-8");

    await withPaiDir(root, async () => {
      const text = await getConversationTextFromThread({ sessionId: "ses_emoji", maxChars: 1 });
      expect(text).toBe("🙂");
      expect(Array.from(text)).toHaveLength(1);
    });
  });
});
