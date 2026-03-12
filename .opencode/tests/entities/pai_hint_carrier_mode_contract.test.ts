import { describe, expect, test } from "bun:test";

import {
  classifyPromptHint,
  resolvePromptHintCarrierMode,
} from "../../plugins/handlers/prompt-hints";

describe("PAI hint carrier-mode contract", () => {
  test("mode resolution honors explicit mode and legacy flag", () => {
    expect(resolvePromptHintCarrierMode({})).toBe("disabled");
    expect(resolvePromptHintCarrierMode({ PAI_ENABLE_CARRIER_PROMPT_HINTS: "1" })).toBe("active");
    expect(
      resolvePromptHintCarrierMode({
        PAI_PROMPT_HINT_CARRIER_MODE: "shadow",
        PAI_ENABLE_CARRIER_PROMPT_HINTS: "1",
      }),
    ).toBe("shadow");
  });

  test("disabled mode skips carrier producer entirely", async () => {
    let createCalls = 0;

    const hint = await classifyPromptHint("continue", "U-disabled", {
      carrierMode: "disabled",
      serverUrl: "http://127.0.0.1:4096",
      client: {
        session: {
          create: async () => {
            createCalls += 1;
            return { data: { id: "S-disabled" } };
          },
        },
      } as any,
    });

    expect(createCalls).toBe(0);
    expect(hint.reducer.selectedProducer).toBe("runtime_heuristic");
    expect(hint.provenance).toHaveLength(1);
  });

  test("shadow mode records carrier provenance while keeping heuristic selected", async () => {
    let createCalls = 0;

    const hint = await classifyPromptHint("continue", "U-shadow", {
      carrierMode: "shadow",
      serverUrl: "http://127.0.0.1:4096",
      client: {
        session: {
          create: async () => {
            createCalls += 1;
            return { data: { id: "S-shadow" } };
          },
          prompt: async () => ({
            data: {
              parts: [
                {
                  type: "text",
                  text: JSON.stringify({
                    depth: "FULL",
                    reasoning_profile: "deep",
                    verbosity: "detailed",
                    capabilities: ["Engineer", "QATester"],
                    thinking_tools: ["FirstPrinciples", "red-team"],
                    confidence: 0.99,
                  }),
                },
              ],
            },
          }),
          delete: async () => ({ ok: true }),
        },
      } as any,
    });

    expect(createCalls).toBe(1);
    expect(hint.reducer.selectedProducer).toBe("runtime_heuristic");
    expect(hint.provenance.some((entry) => entry.producer === "runtime_carrier_openai")).toBe(true);
    expect(hint.provenance.some((entry) => entry.producer === "runtime_carrier_openai" && entry.selected)).toBe(false);
  });

  test("active mode allows deterministic reducer to select carrier producer", async () => {
    const hint = await classifyPromptHint("continue", "U-active", {
      carrierMode: "active",
      serverUrl: "http://127.0.0.1:4096",
      client: {
        session: {
          create: async () => ({ data: { id: "S-active" } }),
          prompt: async () => ({
            data: {
              parts: [
                {
                  type: "text",
                  text: JSON.stringify({
                    depth: "FULL",
                    reasoning_profile: "deep",
                    verbosity: "detailed",
                    capabilities: ["Engineer", "QATester"],
                    thinking_tools: ["FirstPrinciples", "red-team"],
                    confidence: 0.99,
                  }),
                },
              ],
            },
          }),
          delete: async () => ({ ok: true }),
        },
      } as any,
    });

    expect(hint.reducer.selectedProducer).toBe("runtime_carrier_openai");
    expect(hint.source).toBe("openai");
    expect(hint.provenance[0]?.producer).toBe("runtime_carrier_openai");
    expect(hint.provenance[0]?.selected).toBe(true);
  });
});
