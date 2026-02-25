import { describe, expect, test } from "bun:test";

import { createPaiVoiceNotifyTool } from "../../plugins/pai-cc-hooks/tools/voice-notify";

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

describe("PAI voice_notify tool", () => {
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

      expect(JSON.parse(out)).toEqual({ ok: true });
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

      expect(JSON.parse(out)).toEqual({ ok: true });
      expect(fetchCalls).toHaveLength(0);
    } finally {
      restoreEnv("PAI_VOICE_NOTIFY_URL", prevUrl);
    }
  });

  test("lookup fails: does not post", async () => {
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

      expect(JSON.parse(out)).toEqual({ ok: true });
      expect(fetchCalls).toHaveLength(0);
    } finally {
      restoreEnv("PAI_VOICE_NOTIFY_URL", prevUrl);
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

      expect(JSON.parse(out)).toEqual({ ok: true });
      expect(fetchCalls).toHaveLength(0);
    } finally {
      restoreEnv("PAI_VOICE_NOTIFY_URL", prevUrl);
      restoreEnv("PAI_NO_NETWORK", prevNoNetwork);
    }
  });
});
