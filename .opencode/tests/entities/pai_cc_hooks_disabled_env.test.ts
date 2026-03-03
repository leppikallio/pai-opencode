import { describe, expect, test } from "bun:test";

describe("pai-cc-hooks disabled env gate", () => {
	test("when disabled, plugin returns empty object", async () => {
		const initial = process.env.PAI_CC_HOOKS_DISABLED;
		process.env.PAI_CC_HOOKS_DISABLED = "1";

		try {
			const plugin = (await import("../../plugins/pai-cc-hooks")).default;
			const out = await plugin({ client: {}, $: {} } as any);
			expect(out).toEqual({});
		} finally {
			if (typeof initial === "undefined") {
				delete process.env.PAI_CC_HOOKS_DISABLED;
			} else {
				process.env.PAI_CC_HOOKS_DISABLED = initial;
			}
		}
	});

	test("when enabled, plugin registers hooks and tools", async () => {
		const initial = process.env.PAI_CC_HOOKS_DISABLED;
		delete process.env.PAI_CC_HOOKS_DISABLED;

		try {
			const plugin = (await import("../../plugins/pai-cc-hooks")).default;
			const out = await plugin({ client: {}, $: {} } as any);
			expect((out as any)["chat.message"]).toBeDefined();
			expect(out).toHaveProperty("tool.task");
			expect(out).toHaveProperty("tool.voice_notify");
			expect(out).toHaveProperty("tool.background_output");
			expect(out).toHaveProperty("tool.background_cancel");
		} finally {
			if (typeof initial === "undefined") {
				delete process.env.PAI_CC_HOOKS_DISABLED;
			} else {
				process.env.PAI_CC_HOOKS_DISABLED = initial;
			}
		}
	});
});
