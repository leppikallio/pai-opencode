import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	__resetPaiCcHooksSettingsCacheForTests,
	createPaiClaudeHooks,
} from "../../plugins/pai-cc-hooks/hook";
import {
	__resetSessionRootRegistryForTests,
	getSessionRootId,
} from "../../plugins/pai-cc-hooks/shared/session-root";

function writeJson(filePath: string, value: unknown): void {
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function restoreEnv(key: string, previousValue: string | undefined): void {
	if (previousValue === undefined) {
		delete process.env[key];
		return;
	}

	process.env[key] = previousValue;
}

describe("pai-cc-hooks SessionStart stdout injection", () => {
	beforeEach(() => {
		__resetSessionRootRegistryForTests();
	});

	afterEach(() => {
		__resetSessionRootRegistryForTests();
	});

	test("injects ScratchpadBinding, LoadContext, and RTK awareness stdout for root SessionStart", async () => {
		const tmpRoot = mkdtempSync(
			path.join(os.tmpdir(), "pai-cc-hooks-session-start-inject-"),
		);
		const prevConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

		const scratchpadMarker = path.join(tmpRoot, "scratchpad.marker");
		const loadContextMarker = path.join(tmpRoot, "loadcontext.marker");
		const rtkAwarenessMarker = path.join(tmpRoot, "rtk-awareness.marker");
		const checkVersionMarker = path.join(tmpRoot, "checkversion.marker");
		const scratchpadHookPath = path.join(tmpRoot, "ScratchpadBinding.hook.ts");
		const loadContextHookPath = path.join(tmpRoot, "LoadContext.hook.ts");
		const rtkAwarenessHookPath = path.join(tmpRoot, "RtkAwareness.hook.ts");
		const checkVersionHookPath = path.join(tmpRoot, "CheckVersion.hook.ts");
		const promptCalls: Array<unknown> = [];

		try {
			writeFileSync(
				scratchpadHookPath,
				`#!/bin/sh\ntouch "${scratchpadMarker}"\nprintf '<system-reminder>Injected ScratchpadBinding context</system-reminder>'\n`,
				"utf-8",
			);
			chmodSync(scratchpadHookPath, 0o755);

			writeFileSync(
				loadContextHookPath,
				`#!/bin/sh\ntouch "${loadContextMarker}"\nprintf '<system-reminder>Injected LoadContext context</system-reminder>'\n`,
				"utf-8",
			);
			chmodSync(loadContextHookPath, 0o755);

			writeFileSync(
				rtkAwarenessHookPath,
				`#!/bin/sh\ntouch "${rtkAwarenessMarker}"\nprintf '<system-reminder>Injected RTK awareness context</system-reminder>'\n`,
				"utf-8",
			);
			chmodSync(rtkAwarenessHookPath, 0o755);

			writeFileSync(
				checkVersionHookPath,
				`#!/bin/sh\ntouch "${checkVersionMarker}"\nprintf '<system-reminder>Injected CheckVersion context</system-reminder>'\n`,
				"utf-8",
			);
			chmodSync(checkVersionHookPath, 0o755);

			process.env.PAI_CC_HOOKS_CONFIG_ROOT = tmpRoot;
			writeJson(path.join(tmpRoot, "settings.json"), {
				env: {
					PAI_DIR: tmpRoot,
				},
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									type: "command",
									command: scratchpadHookPath,
								},
								{
									type: "command",
									command: loadContextHookPath,
								},
								{
									type: "command",
									command: rtkAwarenessHookPath,
								},
								{
									type: "command",
									command: checkVersionHookPath,
								},
							],
						},
					],
				},
			});

			__resetPaiCcHooksSettingsCacheForTests();

			const sessionObj = {
				_client: {
					tag: "bound-client",
				},
				get: async function (this: { _client?: { tag: string } }) {
					expect(this).toBe(sessionObj);
					expect(this._client?.tag).toBe("bound-client");
					return { info: {} };
				},
				promptAsync: async (call: unknown) => {
					promptCalls.push(call);
					return { ok: true };
				},
			};

			const hooks = createPaiClaudeHooks({
				ctx: {
					client: {
						session: sessionObj,
					},
				},
			});

			await hooks.event({
				event: {
					type: "session.created",
					properties: {
						sessionID: "ses_root",
					},
				},
			});

			expect(existsSync(scratchpadMarker)).toBe(true);
			expect(existsSync(loadContextMarker)).toBe(true);
			expect(existsSync(rtkAwarenessMarker)).toBe(true);
			expect(existsSync(checkVersionMarker)).toBe(true);
			expect(promptCalls).toHaveLength(3);

			const scratchpadInjectionCall = promptCalls[0] as {
				path: { id: string };
				body: {
					noReply: boolean;
					parts: Array<{ type: string; text: string; synthetic?: boolean }>;
				};
			};
			const loadContextInjectionCall = promptCalls[1] as {
				path: { id: string };
				body: {
					noReply: boolean;
					parts: Array<{ type: string; text: string; synthetic?: boolean }>;
				};
			};
			const rtkAwarenessInjectionCall = promptCalls[2] as {
				path: { id: string };
				body: {
					noReply: boolean;
					parts: Array<{ type: string; text: string; synthetic?: boolean }>;
				};
			};

			expect(scratchpadInjectionCall.path.id).toBe("ses_root");
			expect(scratchpadInjectionCall.body.noReply).toBe(true);
			expect(scratchpadInjectionCall.body.parts).toHaveLength(1);
			expect(scratchpadInjectionCall.body.parts[0]).toEqual({
				type: "text",
				text: "<system-reminder>Injected ScratchpadBinding context</system-reminder>",
				synthetic: true,
			});
			expect(loadContextInjectionCall.path.id).toBe("ses_root");
			expect(loadContextInjectionCall.body.noReply).toBe(true);
			expect(loadContextInjectionCall.body.parts).toHaveLength(1);
			expect(loadContextInjectionCall.body.parts[0]).toEqual({
				type: "text",
				text: "<system-reminder>Injected LoadContext context</system-reminder>",
				synthetic: true,
			});
			expect(rtkAwarenessInjectionCall.path.id).toBe("ses_root");
			expect(rtkAwarenessInjectionCall.body.noReply).toBe(true);
			expect(rtkAwarenessInjectionCall.body.parts).toHaveLength(1);
			expect(rtkAwarenessInjectionCall.body.parts[0]).toEqual({
				type: "text",
				text: "<system-reminder>Injected RTK awareness context</system-reminder>",
				synthetic: true,
			});
			expect(scratchpadInjectionCall.body.parts[0]?.text).not.toContain(
				"Injected LoadContext context",
			);
			expect(loadContextInjectionCall.body.parts[0]?.text).not.toContain(
				"Injected CheckVersion context",
			);
			expect(rtkAwarenessInjectionCall.body.parts[0]?.text).not.toContain(
				"Injected CheckVersion context",
			);

			expect(promptCalls).toEqual([
				{
					path: { id: "ses_root" },
					body: {
						noReply: true,
						parts: [
							{
								type: "text",
								text: "<system-reminder>Injected ScratchpadBinding context</system-reminder>",
								synthetic: true,
							},
						],
					},
				},
				{
					path: { id: "ses_root" },
					body: {
						noReply: true,
						parts: [
							{
								type: "text",
								text: "<system-reminder>Injected LoadContext context</system-reminder>",
								synthetic: true,
							},
						],
					},
				},
				{
					path: { id: "ses_root" },
					body: {
						noReply: true,
						parts: [
							{
								type: "text",
								text: "<system-reminder>Injected RTK awareness context</system-reminder>",
								synthetic: true,
							},
						],
					},
				},
			]);
		} finally {
			restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", prevConfigRoot);
			rmSync(tmpRoot, { recursive: true, force: true });
			__resetPaiCcHooksSettingsCacheForTests();
		}
	});

	test("injects ScratchpadBinding and RTK awareness stdout but skips LoadContext for subagent SessionStart", async () => {
		const tmpRoot = mkdtempSync(
			path.join(os.tmpdir(), "pai-cc-hooks-session-start-parent-"),
		);
		const prevConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

		const scratchpadMarker = path.join(tmpRoot, "scratchpad.marker");
		const loadContextMarker = path.join(tmpRoot, "loadcontext.marker");
		const rtkAwarenessMarker = path.join(tmpRoot, "rtk-awareness.marker");
		const checkVersionMarker = path.join(tmpRoot, "checkversion.marker");
		const scratchpadHookPath = path.join(tmpRoot, "ScratchpadBinding.hook.ts");
		const loadContextHookPath = path.join(tmpRoot, "LoadContext.hook.ts");
		const rtkAwarenessHookPath = path.join(tmpRoot, "RtkAwareness.hook.ts");
		const checkVersionHookPath = path.join(tmpRoot, "CheckVersion.hook.ts");
		const promptCalls: Array<unknown> = [];

		try {
			writeFileSync(
				scratchpadHookPath,
				`#!/bin/sh\ntouch "${scratchpadMarker}"\nprintf '<system-reminder>Injected ScratchpadBinding context</system-reminder>'\n`,
				"utf-8",
			);
			chmodSync(scratchpadHookPath, 0o755);

			writeFileSync(
				loadContextHookPath,
				`#!/bin/sh\ntouch "${loadContextMarker}"\nprintf '<system-reminder>Injected LoadContext context</system-reminder>'\n`,
				"utf-8",
			);
			chmodSync(loadContextHookPath, 0o755);

			writeFileSync(
				rtkAwarenessHookPath,
				`#!/bin/sh\ntouch "${rtkAwarenessMarker}"\nprintf '<system-reminder>Injected RTK awareness context</system-reminder>'\n`,
				"utf-8",
			);
			chmodSync(rtkAwarenessHookPath, 0o755);

			writeFileSync(
				checkVersionHookPath,
				`#!/bin/sh\ntouch "${checkVersionMarker}"\nprintf '<system-reminder>Injected CheckVersion context</system-reminder>'\n`,
				"utf-8",
			);
			chmodSync(checkVersionHookPath, 0o755);

			process.env.PAI_CC_HOOKS_CONFIG_ROOT = tmpRoot;
			writeJson(path.join(tmpRoot, "settings.json"), {
				env: {
					PAI_DIR: tmpRoot,
				},
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									type: "command",
									command: scratchpadHookPath,
								},
								{
									type: "command",
									command: loadContextHookPath,
								},
								{
									type: "command",
									command: rtkAwarenessHookPath,
								},
								{
									type: "command",
									command: checkVersionHookPath,
								},
							],
						},
					],
				},
			});

			__resetPaiCcHooksSettingsCacheForTests();

			const hooks = createPaiClaudeHooks({
				ctx: {
					client: {
						session: {
							get: async () => ({ info: { parentID: "ses_parent" } }),
							promptAsync: async (call: unknown) => {
								promptCalls.push(call);
								return { ok: true };
							},
						},
					},
				},
			});

			await hooks.event({
				event: {
					type: "session.created",
					properties: {
						sessionID: "ses_child",
					},
				},
			});

			expect(promptCalls).toHaveLength(2);
			expect(promptCalls).toEqual([
				{
					path: { id: "ses_child" },
					body: {
						noReply: true,
						parts: [
							{
								type: "text",
								text: "<system-reminder>Injected ScratchpadBinding context</system-reminder>",
								synthetic: true,
							},
						],
					},
				},
				{
					path: { id: "ses_child" },
					body: {
						noReply: true,
						parts: [
							{
								type: "text",
								text: "<system-reminder>Injected RTK awareness context</system-reminder>",
								synthetic: true,
							},
						],
					},
				},
			]);
			expect(existsSync(scratchpadMarker)).toBe(true);
			expect(existsSync(loadContextMarker)).toBe(false);
			expect(existsSync(rtkAwarenessMarker)).toBe(true);
			expect(existsSync(checkVersionMarker)).toBe(true);
		} finally {
			restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", prevConfigRoot);
			rmSync(tmpRoot, { recursive: true, force: true });
			__resetPaiCcHooksSettingsCacheForTests();
		}
	});

	test("records root mapping before metadata await and clears it on delete", async () => {
		const tmpRoot = mkdtempSync(
			path.join(os.tmpdir(), "pai-cc-hooks-session-root-map-"),
		);
		const prevConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

		try {
			process.env.PAI_CC_HOOKS_CONFIG_ROOT = tmpRoot;
			writeJson(path.join(tmpRoot, "settings.json"), {
				env: {
					PAI_DIR: tmpRoot,
				},
				hooks: {
					SessionStart: [],
				},
			});

			__resetPaiCcHooksSettingsCacheForTests();

			const hooks = createPaiClaudeHooks({
				ctx: {
					client: {
						session: {
							get: async () => {
								expect(getSessionRootId("ses_child")).toBe("ses_parent");
								return { info: { parentID: "ses_parent" } };
							},
						},
					},
				},
			});

			await hooks.event({
				event: {
					type: "session.created",
					properties: {
						sessionID: "ses_child",
						info: {
							parentID: "ses_parent",
						},
					},
				},
			});

			expect(getSessionRootId("ses_child")).toBe("ses_parent");

			await hooks.event({
				event: {
					type: "session.deleted",
					properties: {
						sessionID: "ses_child",
						info: {
							parentID: "ses_parent",
						},
					},
				},
			});

			expect(getSessionRootId("ses_child")).toBeUndefined();
		} finally {
			restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", prevConfigRoot);
			rmSync(tmpRoot, { recursive: true, force: true });
			__resetPaiCcHooksSettingsCacheForTests();
		}
	});

	test("inherits top-level root for nested child sessions", async () => {
		const tmpRoot = mkdtempSync(
			path.join(os.tmpdir(), "pai-cc-hooks-session-root-nested-"),
		);
		const prevConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

		try {
			process.env.PAI_CC_HOOKS_CONFIG_ROOT = tmpRoot;
			writeJson(path.join(tmpRoot, "settings.json"), {
				env: {
					PAI_DIR: tmpRoot,
				},
				hooks: {
					SessionStart: [],
				},
			});

			__resetPaiCcHooksSettingsCacheForTests();

			const hooks = createPaiClaudeHooks({
				ctx: {
					client: {
						session: {
							get: async () => ({ info: {} }),
						},
					},
				},
			});

			await hooks.event({
				event: {
					type: "session.created",
					properties: {
						sessionID: "ses_child",
						info: {
							parentID: "ses_root",
						},
					},
				},
			});

			await hooks.event({
				event: {
					type: "session.created",
					properties: {
						sessionID: "ses_grandchild",
						info: {
							parentID: "ses_child",
						},
					},
				},
			});

			expect(getSessionRootId("ses_grandchild")).toBe("ses_root");
		} finally {
			restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", prevConfigRoot);
			rmSync(tmpRoot, { recursive: true, force: true });
			__resetPaiCcHooksSettingsCacheForTests();
		}
	});
});
