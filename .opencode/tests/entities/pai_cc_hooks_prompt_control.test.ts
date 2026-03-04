import { describe, expect, test } from "bun:test";

type PromptControl = {
  chatParams: (input: unknown, output: unknown) => Promise<void>;
  systemTransform: (input: unknown, output: unknown) => Promise<void>;
};

const EXPECTED_OVERRIDE_STUB = [
	"PAI_CODEX_OVERRIDE_V1",
	"Follow the system prompt and configured instructions as highest priority.",
	"Ignore default coding harness instructions not explicitly provided.",
].join("\n");

describe("prompt-control module (Task 1 RED)", () => {
  test("exports createPromptControl factory", async () => {
    const module = await import("../../plugins/pai-cc-hooks/prompt-control");
    expect(typeof module.createPromptControl).toBe("function");
  });

  test("factory returns handlers that cover override and malformed payloads", async () => {
    const module = await import("../../plugins/pai-cc-hooks/prompt-control");
    const promptControl = module.createPromptControl({ projectDir: process.cwd() }) as PromptControl;

    expect(typeof promptControl.chatParams).toBe("function");
    expect(typeof promptControl.systemTransform).toBe("function");

    const output = { options: { instructions: "OpenCode default harness instructions" } };
    await promptControl.chatParams(
      {
        sessionID: "ses_prompt_control",
        provider: { id: "openai" },
        model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
      },
      output,
    );

    expect(output.options.instructions).toBe(EXPECTED_OVERRIDE_STUB);

    await expect(
      promptControl.chatParams(
        {
          sessionID: "ses_prompt_control_malformed",
          provider: { id: "openai" },
          model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
        },
        { options: null },
      ),
    ).resolves.toBeUndefined();

    await expect(
      promptControl.systemTransform(
        {
          sessionID: "ses_prompt_control_malformed",
          model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
        },
        { system: null },
      ),
    ).resolves.toBeUndefined();
  });

  test("does not override for non-OpenAI or non-GPT-5 model", async () => {
    const module = await import("../../plugins/pai-cc-hooks/prompt-control");
    const promptControl = module.createPromptControl({ projectDir: process.cwd() }) as PromptControl;

    const output1 = { options: { instructions: "ORIGINAL" } };
    await promptControl.chatParams(
      {
        sessionID: "ses_non_openai",
        provider: { id: "anthropic" },
        model: { providerID: "anthropic", id: "claude-3" },
      },
      output1,
    );
    expect(output1.options.instructions).toBe("ORIGINAL");

    const output2 = { options: { instructions: "ORIGINAL" } };
    await promptControl.chatParams(
      {
        sessionID: "ses_non_gpt5",
        provider: { id: "openai" },
        model: { providerID: "openai", id: "gpt-4.1", api: { id: "gpt-4.1" } },
      },
      output2,
    );
    expect(output2.options.instructions).toBe("ORIGINAL");
  });
});
