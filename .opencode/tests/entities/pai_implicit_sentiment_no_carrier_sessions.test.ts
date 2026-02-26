import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { maybeCaptureImplicitSentiment } from "../../plugins/handlers/sentiment-capture";

describe("implicit sentiment carrier cleanup", () => {
  const prevPaiDir = process.env.PAI_DIR;
  const prevCarrier = process.env.PAI_ENABLE_CARRIER_IMPLICIT_SENTIMENT;

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pai-opencode-sentiment-"));
  process.env.PAI_DIR = tmpRoot;
  delete process.env.PAI_ENABLE_CARRIER_IMPLICIT_SENTIMENT;

  afterAll(() => {
    if (prevPaiDir === undefined) delete process.env.PAI_DIR;
    else process.env.PAI_DIR = prevPaiDir;

    if (prevCarrier === undefined) delete process.env.PAI_ENABLE_CARRIER_IMPLICIT_SENTIMENT;
    else process.env.PAI_ENABLE_CARRIER_IMPLICIT_SENTIMENT = prevCarrier;

    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("creates and deletes carrier session by default", async () => {
    let created = 0;
    let prompted = 0;
    let deleted = 0;

    await maybeCaptureImplicitSentiment({
      sessionId: "S1",
      userMessageId: "U1",
      userText: "This is broken.",
      serverUrl: "http://127.0.0.1:4096",
      client: {
        session: {
          create: async () => {
            created += 1;
            return { data: { id: "S_INTERNAL" } };
          },
          prompt: async () => {
            prompted += 1;
            return {
              data: {
                parts: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      rating: 7,
                      sentiment: "negative",
                      confidence: 0.9,
                      summary: "broken",
                      detailed_context: "User indicates something is broken.",
                    }),
                  },
                ],
              },
            };
          },
          delete: async () => {
            deleted += 1;
            return { ok: true };
          },
        },
      } as any,
    });

    expect(created).toBe(1);
    expect(prompted).toBe(1);
    expect(deleted).toBe(1);
  });

  test("does not create carrier session when disabled", async () => {
    const previous = process.env.PAI_ENABLE_CARRIER_IMPLICIT_SENTIMENT;
    process.env.PAI_ENABLE_CARRIER_IMPLICIT_SENTIMENT = "0";

    try {
      let created = 0;

      await maybeCaptureImplicitSentiment({
        sessionId: "S1",
        userMessageId: "U1",
        userText: "This is broken.",
        serverUrl: "http://127.0.0.1:4096",
        client: {
          session: {
            create: async () => {
              created += 1;
              return { data: { id: "S_INTERNAL" } };
            },
          },
        } as any,
      });

      expect(created).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.PAI_ENABLE_CARRIER_IMPLICIT_SENTIMENT;
      else process.env.PAI_ENABLE_CARRIER_IMPLICIT_SENTIMENT = previous;
    }
  });
});
