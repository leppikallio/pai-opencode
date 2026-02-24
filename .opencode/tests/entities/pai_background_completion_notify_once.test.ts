import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  __resetPaiCcHooksSettingsCacheForTests,
  createPaiClaudeHooks,
} from "../../plugins/pai-cc-hooks/hook";
import {
  getBackgroundTaskStatePath,
  recordBackgroundTaskLaunch,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

describe("pai-cc-hooks background completion notifications", () => {
  test("session.idle for child session notifies cmux and voice once", async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "pai-cc-hooks-bg-complete-"));
    const paiDir = mkdtempSync(path.join(os.tmpdir(), "pai-cc-hooks-bg-complete-pai-"));

    const prevConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;
    const prevPaiDir = process.env.PAI_DIR;
    const prevVoiceNotifyUrl = process.env.PAI_VOICE_NOTIFY_URL;

    const cmuxNotifyCalls: Array<{
      sessionId: string;
      title: string;
      subtitle: string;
      body: string;
    }> = [];
    const voiceNotifyCalls: Array<{ url: string; init: RequestInit | undefined }> = [];

    try {
      process.env.PAI_CC_HOOKS_CONFIG_ROOT = tmpRoot;
      process.env.PAI_DIR = paiDir;
      process.env.PAI_VOICE_NOTIFY_URL = "https://voice.example.test/notify";

      writeJson(path.join(tmpRoot, "settings.json"), {
        env: {
          PAI_DIR: paiDir,
        },
      });

      __resetPaiCcHooksSettingsCacheForTests();

      await recordBackgroundTaskLaunch({
        taskId: "task_child_123",
        childSessionId: "child-session-123",
        parentSessionId: "parent-session-456",
      });

      const hooks = createPaiClaudeHooks({
        ctx: {},
        deps: {
          notifyCmux: async (args) => {
            cmuxNotifyCalls.push(args);
          },
          fetchImpl: async (url, init) => {
            voiceNotifyCalls.push({ url: String(url), init });
            return { ok: true };
          },
        },
      });

      const idleEvent = {
        event: {
          type: "session.idle",
          properties: {
            sessionID: "child-session-123",
          },
        },
      };

      await hooks.event(idleEvent);
      const statePath = getBackgroundTaskStatePath();
      const stateAfterFirstRaw = readFileSync(statePath, "utf-8");
      const stateAfterFirst = JSON.parse(stateAfterFirstRaw) as {
        backgroundTasks?: Record<string, { completed_at_ms?: number }>;
      };
      const firstCompletedAt = stateAfterFirst.backgroundTasks?.task_child_123?.completed_at_ms;
      expect(typeof firstCompletedAt).toBe("number");

      await hooks.event(idleEvent);
      const stateAfterSecondRaw = readFileSync(statePath, "utf-8");
      const stateAfterSecond = JSON.parse(stateAfterSecondRaw) as {
        backgroundTasks?: Record<string, { completed_at_ms?: number }>;
      };

      expect(cmuxNotifyCalls).toHaveLength(1);
      expect(cmuxNotifyCalls[0]).toMatchObject({
        sessionId: "parent-session-456",
      });

      expect(voiceNotifyCalls).toHaveLength(1);
      expect(voiceNotifyCalls[0].url).toBe("https://voice.example.test/notify");
      expect(voiceNotifyCalls[0].init?.method).toBe("POST");

      expect(stateAfterSecondRaw).toBe(stateAfterFirstRaw);
      expect(stateAfterSecond.backgroundTasks?.task_child_123?.completed_at_ms).toBe(firstCompletedAt);
    } finally {
      restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", prevConfigRoot);
      restoreEnv("PAI_DIR", prevPaiDir);
      restoreEnv("PAI_VOICE_NOTIFY_URL", prevVoiceNotifyUrl);
      rmSync(tmpRoot, { recursive: true, force: true });
      rmSync(paiDir, { recursive: true, force: true });
      __resetPaiCcHooksSettingsCacheForTests();
    }
  });
});
