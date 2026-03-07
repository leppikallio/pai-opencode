import { describe, expect, test } from "bun:test";

import { createPaiClaudeHooks } from "../../plugins/pai-cc-hooks/hook";

type CommandExecuteBeforeHandler = (
	input: unknown,
	output: unknown,
) => Promise<void>;

function getCommandExecuteBeforeHandler(args?: {
	publish?: (payload: unknown) => Promise<unknown>;
	showToast?: (payload: unknown) => Promise<unknown>;
	writeMarker?: (sessionId: string) => Promise<void>;
	completeWorkSession?: (sessionId: string) => Promise<unknown>;
	sessionDelete?: (sessionId: string) => Promise<unknown>;
}): {
	handler: CommandExecuteBeforeHandler;
	publishCalls: unknown[];
	showToastCalls: unknown[];
	markerCalls: string[];
	completeCalls: string[];
	deleteCalls: string[];
} {
	const publishCalls: unknown[] = [];
	const showToastCalls: unknown[] = [];
	const markerCalls: string[] = [];
	const completeCalls: string[] = [];
	const deleteCalls: string[] = [];

	const publish = args?.publish
		? async (payload: unknown) => {
			publishCalls.push(payload);
			return await args.publish?.(payload);
		}
		: async (payload: unknown) => {
			publishCalls.push(payload);
		};

	const showToast = args?.showToast
		? async (payload: unknown) => {
			showToastCalls.push(payload);
			return await args.showToast?.(payload);
		}
		: async (payload: unknown) => {
			showToastCalls.push(payload);
		};

	const hooks = createPaiClaudeHooks({
		ctx: {
			client: {
				session: {
					delete: async (payload: unknown) => {
						const sid = (payload as any)?.path?.id;
						if (typeof sid === "string") {
							deleteCalls.push(sid);
						}
						return await args?.sessionDelete?.(sid);
					},
				},
				tui: {
					publish,
					showToast,
				},
			},
		},
		deps: {
			wq: {
				nowMs: () => 0,
				writeMarker: async (sessionId: string) => {
					markerCalls.push(sessionId);
					await args?.writeMarker?.(sessionId);
				},
				completeWorkSession: async (sessionId: string) => {
					completeCalls.push(sessionId);
					return await args?.completeWorkSession?.(sessionId);
				},
				sessionDelete: async (sessionId: string) => {
					deleteCalls.push(sessionId);
					return await args?.sessionDelete?.(sessionId);
				},
			},
		},
	});

	const handler = (hooks as Record<string, unknown>)[
		"command.execute.before"
	] as CommandExecuteBeforeHandler;

	if (typeof handler !== "function") {
		throw new Error("command.execute.before hook is not registered");
	}

	return {
		handler,
		publishCalls,
		showToastCalls,
		markerCalls,
		completeCalls,
		deleteCalls,
	};
}

describe("pai /wq command.execute.before hook", () => {
	test("non-wq command does nothing", async () => {
		const { handler, publishCalls, showToastCalls, markerCalls, completeCalls } =
			getCommandExecuteBeforeHandler();

		await handler({ command: "help" }, {});

		expect(publishCalls).toHaveLength(0);
		expect(showToastCalls).toHaveLength(0);
		expect(markerCalls).toHaveLength(0);
		expect(completeCalls).toHaveLength(0);
	});

	test("wq publish success exits by throwing typed cancellation sentinel", async () => {
		const { handler, publishCalls, showToastCalls, markerCalls, completeCalls, deleteCalls } =
			getCommandExecuteBeforeHandler();

		let thrown: unknown;
		try {
			await handler({ command: "wq", sessionID: "ses_test" }, {});
		} catch (error) {
			thrown = error;
		}

		expect(publishCalls).toEqual([
			{
				body: {
					type: "tui.command.execute",
					properties: {
						command: "app.exit",
					},
				},
			},
		]);
		expect(showToastCalls).toHaveLength(0);
		expect(markerCalls).toEqual(["ses_test"]);
		expect(completeCalls).toEqual(["ses_test"]);
		expect(deleteCalls).toContain("ses_test");
		expect(thrown).toBeDefined();
		expect((thrown as Error).name).toBe("WqExitCancelledError");
		expect((thrown as Error).stack).toBeUndefined();
	});

		test("wq publish failure shows toast and does not throw", async () => {
		const { handler, publishCalls, showToastCalls, markerCalls, completeCalls } =
			getCommandExecuteBeforeHandler({
				publish: async () => {
					throw new Error("publish failed");
				},
			});

		let thrown: unknown;
		try {
			await handler({ command: "wq" }, {});
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeUndefined();
		expect(publishCalls).toHaveLength(1);
		expect(showToastCalls).toEqual([
			{
				body: {
					message: "Failed to exit TUI",
					variant: "error",
					duration: 5000,
				},
			},
		]);
		expect(markerCalls).toHaveLength(0);
		expect(completeCalls).toHaveLength(0);
	});
});
