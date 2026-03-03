import { describe, expect, mock, test } from "bun:test";

const hookAbs =
	"/Users/zuul/Projects/pai-opencode/.worktrees/feat-pai-inference-autostart/.opencode/plugins/pai-cc-hooks/hook.ts";
const stateAbs =
	"/Users/zuul/Projects/pai-opencode/.worktrees/feat-pai-inference-autostart/.opencode/plugins/pai-cc-hooks/tools/background-task-state.ts";
const taskAbs =
	"/Users/zuul/Projects/pai-opencode/.worktrees/feat-pai-inference-autostart/.opencode/plugins/pai-cc-hooks/tools/task.ts";
const voiceAbs =
	"/Users/zuul/Projects/pai-opencode/.worktrees/feat-pai-inference-autostart/.opencode/plugins/pai-cc-hooks/tools/voice-notify.ts";
const outputAbs =
	"/Users/zuul/Projects/pai-opencode/.worktrees/feat-pai-inference-autostart/.opencode/plugins/pai-cc-hooks/tools/background-output.ts";
const cancelAbs =
	"/Users/zuul/Projects/pai-opencode/.worktrees/feat-pai-inference-autostart/.opencode/plugins/pai-cc-hooks/tools/background-cancel.ts";

describe("pai-cc-hooks disabled env gate", () => {
	test("when disabled, plugin returns empty object without importing submodules", async () => {
		const initial = process.env.PAI_CC_HOOKS_DISABLED;
		process.env.PAI_CC_HOOKS_DISABLED = "1";

		mock.module(hookAbs, () => {
			return {
				get createPaiClaudeHooks() {
					throw new Error("hook used unexpectedly");
				},
			};
		});
		mock.module(stateAbs, () => {
			return {
				recordBackgroundTaskLaunch: () => {
					throw new Error("state used unexpectedly");
				},
			};
		});
		mock.module(taskAbs, () => {
			return {
				createPaiTaskTool: () => {
					throw new Error("task tool used unexpectedly");
				},
			};
		});
		mock.module(voiceAbs, () => {
			return {
				createPaiVoiceNotifyTool: () => {
					throw new Error("voice tool used unexpectedly");
				},
			};
		});
		mock.module(outputAbs, () => {
			return {
				createPaiBackgroundOutputTool: () => {
					throw new Error("output tool used unexpectedly");
				},
			};
		});
		mock.module(cancelAbs, () => {
			return {
				createPaiBackgroundCancelTool: () => {
					throw new Error("cancel tool used unexpectedly");
				},
			};
		});

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

		mock.module(hookAbs, () => ({
			createPaiClaudeHooks: () => ({
				event: {},
				"chat.message": async () => {},
				"tool.execute.before": async () => {},
				"tool.execute.after": async () => {},
			}),
		}));
		mock.module(stateAbs, () => ({ recordBackgroundTaskLaunch: () => {} }));
		mock.module(taskAbs, () => ({ createPaiTaskTool: () => ({}) }));
		mock.module(voiceAbs, () => ({ createPaiVoiceNotifyTool: () => ({}) }));
		mock.module(outputAbs, () => ({
			createPaiBackgroundOutputTool: () => ({}),
		}));
		mock.module(cancelAbs, () => ({
			createPaiBackgroundCancelTool: () => ({}),
		}));

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
