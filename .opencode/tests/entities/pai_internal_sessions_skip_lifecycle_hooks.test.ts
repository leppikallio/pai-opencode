import { describe, expect, test } from "bun:test";

import { createPaiClaudeHooks } from "../../plugins/pai-cc-hooks/hook";

type LifecycleCall = {
	sessionId: string;
	hookEventName: string;
};

function createHooksWithLifecycleRecorder(calls: LifecycleCall[]) {
	return createPaiClaudeHooks({
		ctx: {},
		deps: {
			executeSessionLifecycleHooks: async (args) => {
				calls.push({
					sessionId: args.sessionId,
					hookEventName: args.hookEventName,
				});
			},
		},
	});
}

describe("[PAI INTERNAL] sessions skip SessionStart/SessionEnd hooks", () => {
	test("internal session.created does not run SessionStart", async () => {
		const calls: LifecycleCall[] = [];
		const hooks = createHooksWithLifecycleRecorder(calls);

		await hooks.event({
			event: {
				type: "session.created",
				properties: {
					info: {
						id: "ses_internal",
						title: "[PAI INTERNAL] ImplicitSentiment",
					},
				},
			},
		});

		expect(calls).toHaveLength(0);
	});

	test("internal session.deleted does not run SessionEnd (even without prior create)", async () => {
		const calls: LifecycleCall[] = [];
		const hooks = createHooksWithLifecycleRecorder(calls);

		await hooks.event({
			event: {
				type: "session.deleted",
				properties: {
					info: {
						id: "ses_internal",
						title: "[PAI INTERNAL] ImplicitSentiment",
					},
				},
			},
		});

		expect(calls).toHaveLength(0);
	});

	test("non-internal session.created runs SessionStart", async () => {
		const calls: LifecycleCall[] = [];
		const hooks = createHooksWithLifecycleRecorder(calls);

		await hooks.event({
			event: {
				type: "session.created",
				properties: {
					info: {
						id: "ses_normal",
						title: "Normal session",
					},
				},
			},
		});

		expect(calls).toEqual([
			{ sessionId: "ses_normal", hookEventName: "SessionStart" },
		]);
	});

	test("non-internal root session.deleted runs SessionEnd", async () => {
		const calls: LifecycleCall[] = [];
		const hooks = createHooksWithLifecycleRecorder(calls);

		await hooks.event({
			event: {
				type: "session.deleted",
				properties: {
					info: {
						id: "ses_normal",
						title: "Normal session",
					},
				},
			},
		});

		expect(calls).toEqual([
			{ sessionId: "ses_normal", hookEventName: "SessionEnd" },
		]);
	});
});
