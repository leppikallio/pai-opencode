import { describe, expect, test } from "bun:test";

import { classifyPromptHint } from "../../plugins/handlers/prompt-hints";
import { containsImperativeHintField } from "../../plugins/shared/hint-envelope";
import {
  PROMPT_CLASSIFIER_SYSTEM_PROMPT,
  createHeuristicPromptHintCandidate,
} from "../../plugins/shared/prompt-classifier-contract";
import { classifyPromptToHintEnvelope } from "../../skills/PAI/Tools/PromptClassifier";

describe("PAI hint producer parity", () => {
  test("runtime and utility producers emit matching advisory schema when carrier is disabled", async () => {
    let carrierSessionCreates = 0;
    const prompt = "Implement focused tests for deterministic routing hint behavior";

    const runtimeHint = await classifyPromptHint(prompt, "U-runtime", {
      serverUrl: "http://127.0.0.1:4096",
      carrierMode: "disabled",
      client: {
        session: {
          create: async () => {
            carrierSessionCreates += 1;
            return { data: { id: "should-not-run" } };
          },
        },
      } as any,
    });

    const utilityHint = await classifyPromptToHintEnvelope(prompt, {
      carrierMode: "disabled",
    });

    const sharedRuntimeCandidate = createHeuristicPromptHintCandidate(
      prompt,
      "runtime_default",
    );
    const sharedUtilityCandidate = createHeuristicPromptHintCandidate(prompt, "utility");

    expect(carrierSessionCreates).toBe(0);
    expect(runtimeHint.reducer.selectedProducer).toBe("runtime_heuristic");
    expect(utilityHint.reducer.selectedProducer).toBe("runtime_heuristic");
    expect(runtimeHint.advisory).toEqual(utilityHint.advisory);
    expect(runtimeHint.advisory).toEqual(sharedRuntimeCandidate.advisory);
    expect(utilityHint.advisory).toEqual(sharedUtilityCandidate.advisory);
    expect(runtimeHint.advisory.capabilities.length).toBeGreaterThan(0);
    expect(containsImperativeHintField(runtimeHint)).toBe(false);
    expect(containsImperativeHintField(utilityHint)).toBe(false);
  });

  test("runtime carrier path uses shared classifier system prompt contract", async () => {
    let capturedSystemPrompt = "";

    await classifyPromptHint("continue", "U-runtime-shared-prompt", {
      carrierMode: "active",
      serverUrl: "http://127.0.0.1:4096",
      client: {
        session: {
          create: async () => ({ data: { id: "S-shared-prompt" } }),
          prompt: async (request: any) => {
            capturedSystemPrompt = String(request?.body?.system ?? "");
            return {
              data: {
                parts: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      depth: "FULL",
                      reasoning_profile: "deep",
                      verbosity: "detailed",
                      capabilities: ["Engineer"],
                      thinking_tools: ["FirstPrinciples"],
                      confidence: 0.9,
                    }),
                  },
                ],
              },
            };
          },
          delete: async () => ({ ok: true }),
        },
      } as any,
    });

    expect(capturedSystemPrompt).toBe(PROMPT_CLASSIFIER_SYSTEM_PROMPT);
  });
});
