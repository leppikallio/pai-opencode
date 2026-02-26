import { afterAll, describe, expect, test } from "bun:test";

import { classifyPromptHint } from "../../plugins/handlers/prompt-hints";

describe("prompt-hints carrier gating", () => {
  const prev = process.env.PAI_ENABLE_CARRIER_PROMPT_HINTS;
  delete process.env.PAI_ENABLE_CARRIER_PROMPT_HINTS;

  afterAll(() => {
    if (prev === undefined) delete process.env.PAI_ENABLE_CARRIER_PROMPT_HINTS;
    else process.env.PAI_ENABLE_CARRIER_PROMPT_HINTS = prev;
  });

  test("does not create [PAI INTERNAL] sessions by default", async () => {
    let created = 0;

    const hint = await classifyPromptHint("Continue.", "U1", {
      serverUrl: "http://127.0.0.1:4096",
      client: {
        session: {
          create: async () => {
            created += 1;
            return { data: { id: "S1" } };
          },
        },
      } as any,
    });

    expect(created).toBe(0);
    expect(hint.source).toBe("heuristic");
  });
});
