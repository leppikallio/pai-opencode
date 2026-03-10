import { describe, expect, test } from "bun:test";

import PaiCcHooksPlugin from "../../plugins/pai-cc-hooks";

type PluginHooks = Record<string, unknown>;

const ROUTING_INVARIANT_BLOCK = [
	"<native-routing-invariants-v1>",
	"EXPLICIT_ROUTING_CUE:@general->task",
	"EXPLICIT_ROUTING_CUE:@agent->task",
	"</native-routing-invariants-v1>",
].join("\n");

const EXPECTED_OVERRIDE_STUB = [
	"PAI_CODEX_OVERRIDE_V1",
	"Follow the system prompt and configured instructions as highest priority.",
	"Ignore default coding harness instructions not explicitly provided.",
].join("\n");

const GPT5_INPUT = {
	sessionID: "ses_task_gpt5_routing",
	provider: { id: "openai" },
	model: { providerID: "openai", id: "gpt-5", api: { id: "gpt-5" } },
};

function restoreEnv(key: string, previousValue: string | undefined): void {
	if (previousValue === undefined) {
		delete process.env[key];
		return;
	}

	process.env[key] = previousValue;
}

async function withEnv<T>(
	key: string,
	value: string | undefined,
	run: () => Promise<T>,
): Promise<T> {
	const previousValue = process.env[key];
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}

	try {
		return await run();
	} finally {
		restoreEnv(key, previousValue);
	}
}

async function createPluginHooks(): Promise<PluginHooks> {
	const previousDisabled = process.env.PAI_CC_HOOKS_DISABLED;
	delete process.env.PAI_CC_HOOKS_DISABLED;

	try {
		return (await PaiCcHooksPlugin({ client: {}, $: {} } as any)) as PluginHooks;
	} finally {
		restoreEnv("PAI_CC_HOOKS_DISABLED", previousDisabled);
	}
}

function getHook(
	plugin: PluginHooks,
	key: "chat.params" | "experimental.chat.system.transform",
): ((input: unknown, output: unknown) => Promise<void>) {
	const hook = plugin[key];
	if (typeof hook !== "function") {
		throw new Error(`Missing hook: ${key}`);
	}

	return hook as (input: unknown, output: unknown) => Promise<void>;
}

describe("PAI GPT-5 routing integration contract (Tasks 2+3)", () => {
	test("GPT-5 chat.params keeps routing-critical guidance additive", async () => {
		const plugin = await createPluginHooks();
		const chatParams = getHook(plugin, "chat.params");

		const output = {
			options: {
				instructions: `${ROUTING_INVARIANT_BLOCK}\n\nORIGINAL_GUIDANCE`,
			},
		};

		await chatParams(GPT5_INPUT, output);

		expect(output.options.instructions.includes(ROUTING_INVARIANT_BLOCK)).toBe(true);
		expect(output.options.instructions.includes("ORIGINAL_GUIDANCE")).toBe(true);
		expect(output.options.instructions.includes(EXPECTED_OVERRIDE_STUB)).toBe(true);
		expect(output.options.instructions.includes("PAI SCRATCHPAD (Binding)")).toBe(true);
	});

	test("GPT-5 clean-slate transform preserves explicit native-routing invariant block", async () => {
		const plugin = await createPluginHooks();
		const systemTransform = getHook(plugin, "experimental.chat.system.transform");

		const output: { system: unknown } = {
			system: [ROUTING_INVARIANT_BLOCK, "TAIL"],
		};

		await systemTransform(GPT5_INPUT, output);

		const system0 = (output.system as string[])[0] ?? "";
		expect(system0.includes(ROUTING_INVARIANT_BLOCK)).toBe(true);
		expect(system0.includes("PAI_CODEX_CLEAN_SLATE_V1")).toBe(true);
	});

	test("GPT-5 routing path keeps explicit @agent cues visible in prompt stack", async () => {
		const plugin = await createPluginHooks();
		const chatParams = getHook(plugin, "chat.params");
		const systemTransform = getHook(plugin, "experimental.chat.system.transform");

		const chatOutput = {
			options: {
				instructions: ROUTING_INVARIANT_BLOCK,
			},
		};
		const systemOutput: { system: unknown } = {
			system: [ROUTING_INVARIANT_BLOCK],
		};

		await chatParams(GPT5_INPUT, chatOutput);
		await systemTransform(GPT5_INPUT, systemOutput);

		const combined = `${chatOutput.options.instructions}\n${(systemOutput.system as string[])[0] ?? ""}`;
		expect(combined.includes("EXPLICIT_ROUTING_CUE:@general->task")).toBe(true);
		expect(combined.includes("EXPLICIT_ROUTING_CUE:@agent->task")).toBe(true);
	});

	test("GPT-5 routing clean-slate flag OFF keeps explicit routing cues visible", async () => {
		await withEnv("PAI_CODEX_CLEAN_SLATE", "0", async () => {
			const plugin = await createPluginHooks();
			const chatParams = getHook(plugin, "chat.params");
			const systemTransform = getHook(plugin, "experimental.chat.system.transform");

			const chatOutput = {
				options: {
					instructions: `${ROUTING_INVARIANT_BLOCK}\n\nORIGINAL_GUIDANCE`,
				},
			};
			const systemOutput: { system: unknown } = {
				system: [ROUTING_INVARIANT_BLOCK],
			};

			await chatParams(GPT5_INPUT, chatOutput);
			await systemTransform(GPT5_INPUT, systemOutput);

			expect(chatOutput.options.instructions.includes(ROUTING_INVARIANT_BLOCK)).toBe(
				true,
			);
			expect(chatOutput.options.instructions.includes("ORIGINAL_GUIDANCE")).toBe(true);
			expect(chatOutput.options.instructions.includes(EXPECTED_OVERRIDE_STUB)).toBe(
				false,
			);

			const system0 = (systemOutput.system as string[])[0] ?? "";
			expect(system0.includes(ROUTING_INVARIANT_BLOCK)).toBe(true);
		});
	});

	test("task tool description remains routing-complete for explicit @agent handoff", async () => {
		const plugin = await createPluginHooks();
		const toolRegistry = plugin.tool as
			| { task?: { description?: string } }
			| undefined;
		const taskTool = toolRegistry?.task;

		expect(typeof taskTool?.description).toBe("string");
		expect(taskTool?.description).toContain("@general / @<agent>");
		expect(taskTool?.description).toContain("run_in_background:true");
		expect(taskTool?.description).toContain("task_id");
	});
});
