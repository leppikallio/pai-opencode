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

	test("injects only LoadContext stdout for root SessionStart", async () => {
		const tmpRoot = mkdtempSync(
			path.join(os.tmpdir(), "pai-cc-hooks-session-start-inject-"),
		);
		const prevConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

		const loadContextMarker = path.join(tmpRoot, "loadcontext.marker");
		const checkVersionMarker = path.join(tmpRoot, "checkversion.marker");
		const loadContextHookPath = path.join(tmpRoot, "LoadContext.hook.ts");
		const checkVersionHookPath = path.join(tmpRoot, "CheckVersion.hook.ts");
		const promptCalls: Array<unknown> = [];

		try {
			writeFileSync(
				loadContextHookPath,
				`#!/bin/sh\ntouch "${loadContextMarker}"\nprintf '<system-reminder>Injected LoadContext context</system-reminder>'\n`,
				"utf-8",
			);
			chmodSync(loadContextHookPath, 0o755);

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
									command: loadContextHookPath,
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

			expect(existsSync(loadContextMarker)).toBe(true);
			expect(existsSync(checkVersionMarker)).toBe(true);
			expect(promptCalls).toHaveLength(1);

			const injectionCall = promptCalls[0] as {
				path: { id: string };
				body: {
					noReply: boolean;
					parts: Array<{ type: string; text: string; synthetic?: boolean }>;
				};
			};

			expect(injectionCall.path.id).toBe("ses_root");
			expect(injectionCall.body.noReply).toBe(true);
			expect(injectionCall.body.parts).toHaveLength(1);
			expect(injectionCall.body.parts[0]).toEqual({
				type: "text",
				text: "<system-reminder>Injected LoadContext context</system-reminder>",
				synthetic: true,
			});
			expect(injectionCall.body.parts[0]?.text).not.toContain(
				"Injected CheckVersion context",
			);

			expect(injectionCall).toEqual({
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
			});
		} finally {
			restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", prevConfigRoot);
			rmSync(tmpRoot, { recursive: true, force: true });
			__resetPaiCcHooksSettingsCacheForTests();
		}
	});

	test("does not inject SessionStart stdout when parentID is present", async () => {
		const tmpRoot = mkdtempSync(
			path.join(os.tmpdir(), "pai-cc-hooks-session-start-parent-"),
		);
		const prevConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

		const loadContextMarker = path.join(tmpRoot, "loadcontext.marker");
		const checkVersionMarker = path.join(tmpRoot, "checkversion.marker");
		const loadContextHookPath = path.join(tmpRoot, "LoadContext.hook.ts");
		const checkVersionHookPath = path.join(tmpRoot, "CheckVersion.hook.ts");
		const promptCalls: Array<unknown> = [];

		try {
			writeFileSync(
				loadContextHookPath,
				`#!/bin/sh\ntouch "${loadContextMarker}"\nprintf '<system-reminder>Injected LoadContext context</system-reminder>'\n`,
				"utf-8",
			);
			chmodSync(loadContextHookPath, 0o755);

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
									command: loadContextHookPath,
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

			expect(promptCalls).toHaveLength(0);
			expect(existsSync(loadContextMarker)).toBe(false);
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
