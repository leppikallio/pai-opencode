import { describe, expect, test } from "bun:test";

import PaiCcHooksPlugin from "../../plugins/pai-cc-hooks";

type PluginHooks = Record<string, unknown>;

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

async function createPluginOutput(): Promise<PluginHooks> {
  const previousDisabled = process.env.PAI_CC_HOOKS_DISABLED;
  delete process.env.PAI_CC_HOOKS_DISABLED;

  try {
    return (await PaiCcHooksPlugin({ client: {}, $: {} } as any)) as PluginHooks;
  } finally {
    restoreEnv("PAI_CC_HOOKS_DISABLED", previousDisabled);
  }
}

function getHookFn(
	plugin: PluginHooks,
	key: string,
): ((input: unknown, output: unknown) => Promise<void>) | null {
	const v = plugin[key];
	return typeof v === "function" ? (v as any) : null;
}

describe("pai-cc-hooks prompt control integration", () => {
	test("when disabled, plugin returns empty object", async () => {
		const previousDisabled = process.env.PAI_CC_HOOKS_DISABLED;
		process.env.PAI_CC_HOOKS_DISABLED = "1";
		try {
			const out = (await PaiCcHooksPlugin({ client: {}, $: {} } as any)) as PluginHooks;
			expect(Object.keys(out).length).toBe(0);
		} finally {
			restoreEnv("PAI_CC_HOOKS_DISABLED", previousDisabled);
		}
	});

  test("registers chat.params and experimental.chat.system.transform hooks", async () => {
    const plugin = await createPluginOutput();

    expect(typeof plugin["chat.params"]).toBe("function");
    expect(typeof plugin["experimental.chat.system.transform"]).toBe("function");
  });

  test("routes OpenAI GPT-5 params through prompt override hook", async () => {
    const plugin = await createPluginOutput();
    const chatParams = getHookFn(plugin, "chat.params");
    if (!chatParams) return;

    const output = {
      options: {
        instructions: "OpenCode default harness instructions",
      },
    };

    await chatParams(
      {
        sessionID: "ses_integration_prompt_control",
        provider: { id: "openai" },
        model: {
          providerID: "openai",
          id: "gpt-5",
          api: { id: "gpt-5" },
        },
      },
      output,
    );

    expect(output.options.instructions).toContain("PAI_CODEX_OVERRIDE_V1");
    expect(output.options.instructions).not.toContain("OpenCode default harness instructions");
  });

  test("does not throw when prompt-control hooks receive malformed payloads", async () => {
    const plugin = await createPluginOutput();
    const chatParams = getHookFn(plugin, "chat.params");
    const systemTransform = getHookFn(plugin, "experimental.chat.system.transform");
    if (!chatParams || !systemTransform) return;

    await expect(
      chatParams(
        {
          sessionID: "ses_integration_malformed",
          provider: { id: "openai" },
          model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
        },
        { options: null },
      ),
    ).resolves.toBeUndefined();

    const output: { system: unknown } = { system: null };
    await expect(
      systemTransform(
        {
          sessionID: "ses_integration_malformed",
          model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
        },
        output,
      ),
    ).resolves.toBeUndefined();

		expect(output.system).toBeNull();
  });
});
