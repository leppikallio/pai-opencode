import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	__resetPaiCcHooksSettingsCacheForTests,
	createPaiClaudeHooks,
} from "../../plugins/pai-cc-hooks/hook";
import {
	recordBackgroundTaskLaunch,
	recordBackgroundTaskLaunchError,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";

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

describe("pai-cc-hooks background completion attention", () => {
	test("routes completion through attention once with concise summary reason", async () => {
		const tmpRoot = mkdtempSync(
			path.join(os.tmpdir(), "pai-cc-hooks-bg-attention-"),
		);
		const paiDir = mkdtempSync(
			path.join(os.tmpdir(), "pai-cc-hooks-bg-attention-pai-"),
		);

		const prevConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;
		const prevOpenCodeRoot = process.env.OPENCODE_ROOT;
		const prevVoiceNotifyUrl = process.env.PAI_VOICE_NOTIFY_URL;

		const attentionCalls: Array<{
			eventKey: string;
			sessionId: string;
			reasonShort?: string | null;
		}> = [];
		const legacyCmuxNotifyCalls: Array<{
			sessionId: string;
			title: string;
			subtitle: string;
			body: string;
		}> = [];
		const voiceNotifyCalls: Array<{
			url: string;
			init: RequestInit | undefined;
		}> = [];

		try {
			process.env.PAI_CC_HOOKS_CONFIG_ROOT = tmpRoot;
			process.env.OPENCODE_ROOT = paiDir;
			process.env.PAI_VOICE_NOTIFY_URL = "https://voice.example.test/notify";

			writeJson(path.join(tmpRoot, "settings.json"), {
				env: {
					PAI_DIR: paiDir,
				},
			});

			__resetPaiCcHooksSettingsCacheForTests();

			await recordBackgroundTaskLaunch({
				taskId: "task_child_123",
				taskDescription: "Generate release notes from git history",
				childSessionId: "child-session-123",
				parentSessionId: "parent-session-456",
			});

			const hooks = createPaiClaudeHooks({
				ctx: {
					client: {
						session: {
							get: async () => ({ info: {} }),
						},
					},
				},
				deps: {
					emitCompletionAttention: async (event) => {
						attentionCalls.push(event);
					},
					notifyCmux: async (args) => {
						legacyCmuxNotifyCalls.push(args);
					},
					fetchImpl: async (url, init) => {
						voiceNotifyCalls.push({ url: String(url), init });
						return { ok: true };
					},
				},
			});

			const idleEvent = {
				event: {
					type: "session.idle",
					properties: {
						sessionID: "child-session-123",
					},
				},
			};

			await hooks.event(idleEvent);
			await hooks.event(idleEvent);

			expect(attentionCalls).toHaveLength(1);
			expect(attentionCalls[0]).toMatchObject({
				eventKey: "AGENT_COMPLETED",
				sessionId: "parent-session-456",
				reasonShort:
					"Background task completed: Generate release notes from git history",
			});

			expect(legacyCmuxNotifyCalls).toHaveLength(0);

			expect(voiceNotifyCalls).toHaveLength(1);
			expect(voiceNotifyCalls[0].url).toBe("https://voice.example.test/notify");
			expect(voiceNotifyCalls[0].init?.method).toBe("POST");
		} finally {
			restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", prevConfigRoot);
			restoreEnv("OPENCODE_ROOT", prevOpenCodeRoot);
			restoreEnv("PAI_VOICE_NOTIFY_URL", prevVoiceNotifyUrl);
			rmSync(tmpRoot, { recursive: true, force: true });
			rmSync(paiDir, { recursive: true, force: true });
			__resetPaiCcHooksSettingsCacheForTests();
		}
	});

	test("routes launch errors through attention with concise failure reason", async () => {
		const tmpRoot = mkdtempSync(
			path.join(os.tmpdir(), "pai-cc-hooks-bg-attention-failed-"),
		);
		const paiDir = mkdtempSync(
			path.join(os.tmpdir(), "pai-cc-hooks-bg-attention-failed-pai-"),
		);

		const prevConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;
		const prevOpenCodeRoot = process.env.OPENCODE_ROOT;
		const prevVoiceNotifyUrl = process.env.PAI_VOICE_NOTIFY_URL;

		const attentionCalls: Array<{
			eventKey: string;
			sessionId: string;
			reasonShort?: string | null;
		}> = [];
		const voiceNotifyCalls: Array<{
			url: string;
			init: RequestInit | undefined;
		}> = [];

		try {
			process.env.PAI_CC_HOOKS_CONFIG_ROOT = tmpRoot;
			process.env.OPENCODE_ROOT = paiDir;
			process.env.PAI_VOICE_NOTIFY_URL = "https://voice.example.test/notify";

			writeJson(path.join(tmpRoot, "settings.json"), {
				env: {
					PAI_DIR: paiDir,
				},
			});

			__resetPaiCcHooksSettingsCacheForTests();

			await recordBackgroundTaskLaunch({
				taskId: "task_child_456",
				taskDescription: "Collect benchmark telemetry from nightly run",
				childSessionId: "child-session-456",
				parentSessionId: "parent-session-789",
			});

			await recordBackgroundTaskLaunchError({
				taskId: "task_child_456",
				errorMessage:
					"prompt send exploded for bg_ses_child-456 while opening child session",
			});

			const hooks = createPaiClaudeHooks({
				ctx: {
					client: {
						session: {
							get: async () => ({ info: {} }),
						},
					},
				},
				deps: {
					emitCompletionAttention: async (event) => {
						attentionCalls.push(event);
					},
					fetchImpl: async (url, init) => {
						voiceNotifyCalls.push({ url: String(url), init });
						return { ok: true };
					},
				},
			});

			await hooks.event({
				event: {
					type: "session.idle",
					properties: {
						sessionID: "child-session-456",
					},
				},
			});

			expect(attentionCalls).toHaveLength(1);
			expect(attentionCalls[0]).toMatchObject({
				eventKey: "AGENT_COMPLETED",
				sessionId: "parent-session-789",
				reasonShort:
					"Background task failed: prompt send exploded for background task while opening child session",
			});

			expect(attentionCalls[0]?.reasonShort).not.toContain("bg_ses_child-456");

			expect(voiceNotifyCalls).toHaveLength(1);
			expect(voiceNotifyCalls[0].url).toBe("https://voice.example.test/notify");
			expect(voiceNotifyCalls[0].init?.method).toBe("POST");
		} finally {
			restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", prevConfigRoot);
			restoreEnv("OPENCODE_ROOT", prevOpenCodeRoot);
			restoreEnv("PAI_VOICE_NOTIFY_URL", prevVoiceNotifyUrl);
			rmSync(tmpRoot, { recursive: true, force: true });
			rmSync(paiDir, { recursive: true, force: true });
			__resetPaiCcHooksSettingsCacheForTests();
		}
	});
});
