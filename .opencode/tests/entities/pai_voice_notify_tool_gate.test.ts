import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPaiVoiceNotifyTool } from "../../plugins/pai-cc-hooks/tools/voice-notify";

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

describe("PAI voice_notify tool", () => {
  test("uses default localhost notify URL when env is unset", async () => {
    const prevNotify = process.env.PAI_VOICE_NOTIFY_URL;
    const prevServer = process.env.PAI_VOICE_SERVER_URL;
    delete process.env.PAI_VOICE_NOTIFY_URL;
    delete process.env.PAI_VOICE_SERVER_URL;

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    try {
      const toolDef = createPaiVoiceNotifyTool({
        client: {
          session: {
            get: async () => ({ data: { info: {} } }),
          },
        },
        fetchImpl: async (url, init) => {
          fetchCalls.push({ url: String(url), init });
          return { ok: true };
        },
      });

      const out = await toolDef.execute(
        { message: "hello" },
        { sessionID: "root-session-1", directory: "/tmp" } as any,
      );

      expect(JSON.parse(out)).toMatchObject({ ok: true, sent: true });
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toBe("http://localhost:8888/notify");
    } finally {
      restoreEnv("PAI_VOICE_NOTIFY_URL", prevNotify);
      restoreEnv("PAI_VOICE_SERVER_URL", prevServer);
    }
  });

  test("root session allowed: posts once", async () => {
    const prevUrl = process.env.PAI_VOICE_NOTIFY_URL;
    process.env.PAI_VOICE_NOTIFY_URL = "https://voice.example.test/notify";

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    try {
      const toolDef = createPaiVoiceNotifyTool({
        client: {
          session: {
            get: async () => ({ info: {} }),
          },
        },
        fetchImpl: async (url, init) => {
          fetchCalls.push({ url: String(url), init });
          return { ok: true };
        },
      });

      const out = await toolDef.execute(
        { message: "hello" },
        { sessionID: "root-session-1", directory: "/tmp" } as any,
      );

      expect(JSON.parse(out)).toMatchObject({ ok: true, sent: true });
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toBe("https://voice.example.test/notify");
      expect(fetchCalls[0].init?.method).toBe("POST");
    } finally {
      restoreEnv("PAI_VOICE_NOTIFY_URL", prevUrl);
    }
  });

  test("subagent blocked: does not post", async () => {
    const prevUrl = process.env.PAI_VOICE_NOTIFY_URL;
    process.env.PAI_VOICE_NOTIFY_URL = "https://voice.example.test/notify";

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    try {
      const toolDef = createPaiVoiceNotifyTool({
        client: {
          session: {
            get: async () => ({ info: { parentID: "parent-session" } }),
          },
        },
        fetchImpl: async (url, init) => {
          fetchCalls.push({ url: String(url), init });
          return { ok: true };
        },
      });

      const out = await toolDef.execute(
        { message: "hello" },
        { sessionID: "child-session-1", directory: "/tmp" } as any,
      );

      expect(JSON.parse(out)).toMatchObject({ ok: true, skipped: "session_has_parent" });
      expect(fetchCalls).toHaveLength(0);
    } finally {
      restoreEnv("PAI_VOICE_NOTIFY_URL", prevUrl);
    }
  });

  test("lookup fails: root-assumed fallback still posts", async () => {
    const prevUrl = process.env.PAI_VOICE_NOTIFY_URL;
    process.env.PAI_VOICE_NOTIFY_URL = "https://voice.example.test/notify";

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    try {
      const toolDef = createPaiVoiceNotifyTool({
        client: {
          session: {
            get: async () => {
              throw new Error("boom");
            },
          },
        },
        fetchImpl: async (url, init) => {
          fetchCalls.push({ url: String(url), init });
          return { ok: true };
        },
      });

      const out = await toolDef.execute(
        { message: "hello" },
        { sessionID: "root-session-1", directory: "/tmp" } as any,
      );

      expect(JSON.parse(out)).toMatchObject({ ok: true, sent: true });
      expect(fetchCalls).toHaveLength(1);
    } finally {
      restoreEnv("PAI_VOICE_NOTIFY_URL", prevUrl);
    }
  });

  test("lookup fails but known background child: blocked", async () => {
    const prevUrl = process.env.PAI_VOICE_NOTIFY_URL;
    const prevPaiDir = process.env.PAI_DIR;
    process.env.PAI_VOICE_NOTIFY_URL = "https://voice.example.test/notify";

    const tmpPaiDir = fs.mkdtempSync(path.join(os.tmpdir(), "pai-voice-gate-state-"));
    process.env.PAI_DIR = tmpPaiDir;
    writeJson(path.join(tmpPaiDir, "MEMORY", "STATE", "background-tasks.json"), {
      version: 1,
      updatedAtMs: Date.now(),
      notifiedTaskIds: {},
      duplicateBySession: {},
      backgroundTasks: {
        bg_ses_child1: {
          task_id: "bg_ses_child1",
          child_session_id: "child-session-1",
          parent_session_id: "parent-session-1",
          launched_at_ms: Date.now(),
          updated_at_ms: Date.now(),
        },
      },
    });

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    try {
      const toolDef = createPaiVoiceNotifyTool({
        client: {
          session: {
            get: async () => {
              throw new Error("boom");
            },
          },
        },
        fetchImpl: async (url, init) => {
          fetchCalls.push({ url: String(url), init });
          return { ok: true };
        },
      });

      const out = await toolDef.execute(
        { message: "hello" },
        { sessionID: "child-session-1", directory: "/tmp" } as any,
      );

      expect(JSON.parse(out)).toMatchObject({ ok: true, skipped: "known_background_child" });
      expect(fetchCalls).toHaveLength(0);
    } finally {
      restoreEnv("PAI_VOICE_NOTIFY_URL", prevUrl);
      restoreEnv("PAI_DIR", prevPaiDir);
      fs.rmSync(tmpPaiDir, { recursive: true, force: true });
    }
  });

  test("no-network: does not post", async () => {
    const prevUrl = process.env.PAI_VOICE_NOTIFY_URL;
    const prevNoNetwork = process.env.PAI_NO_NETWORK;
    process.env.PAI_VOICE_NOTIFY_URL = "https://voice.example.test/notify";
    process.env.PAI_NO_NETWORK = "1";

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    try {
      const toolDef = createPaiVoiceNotifyTool({
        client: {
          session: {
            get: async () => ({ info: {} }),
          },
        },
        fetchImpl: async (url, init) => {
          fetchCalls.push({ url: String(url), init });
          return { ok: true };
        },
      });

      const out = await toolDef.execute(
        { message: "hello" },
        { sessionID: "root-session-1", directory: "/tmp" } as any,
      );

      expect(JSON.parse(out)).toMatchObject({ ok: true, skipped: "no_network" });
      expect(fetchCalls).toHaveLength(0);
    } finally {
      restoreEnv("PAI_VOICE_NOTIFY_URL", prevUrl);
      restoreEnv("PAI_NO_NETWORK", prevNoNetwork);
    }
  });

  test("wrapper-shaped session.get response with parent blocks voice", async () => {
    const prevUrl = process.env.PAI_VOICE_NOTIFY_URL;
    process.env.PAI_VOICE_NOTIFY_URL = "https://voice.example.test/notify";

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    try {
      const toolDef = createPaiVoiceNotifyTool({
        client: {
          session: {
            get: async () => ({ data: { info: { parentID: "parent-session" } } }),
          },
        },
        fetchImpl: async (url, init) => {
          fetchCalls.push({ url: String(url), init });
          return { ok: true };
        },
      });

      const out = await toolDef.execute(
        { message: "hello" },
        { sessionID: "child-session-1", directory: "/tmp" } as any,
      );

      expect(JSON.parse(out)).toMatchObject({ ok: true, skipped: "session_has_parent" });
      expect(fetchCalls).toHaveLength(0);
    } finally {
      restoreEnv("PAI_VOICE_NOTIFY_URL", prevUrl);
    }
  });
});
