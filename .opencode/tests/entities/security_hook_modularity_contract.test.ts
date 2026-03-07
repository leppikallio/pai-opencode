import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
	readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	__resetPaiCcHooksSettingsCacheForTests,
	createPaiClaudeHooks,
} from "../../plugins/pai-cc-hooks/hook";

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

function extractConfirmId(errText: string): string {
	const match = errText.match(/PAI_CONFIRM\s+(pai_confirm_[a-z0-9]+)/);
	if (!match?.[1]) {
		throw new Error(`Missing confirm id in error text: ${errText}`);
	}

	return match[1];
}

describe("pai-cc-hooks modularity contract", () => {
	test("keeps hook.ts as a composition root and delegates to thin modules", () => {
		const pluginDir = path.resolve(
			import.meta.dir,
			"..",
			"..",
			"plugins",
			"pai-cc-hooks",
		);
		const hookPath = path.join(pluginDir, "hook.ts");
		const requiredModules = [
			"ask-gate.ts",
			"session-helpers.ts",
			"tool-before.ts",
			"tool-after.ts",
			"background-completion.ts",
			"session-lifecycle.ts",
			"chat-message.ts",
			"settings-cache.ts",
		];

		for (const moduleName of requiredModules) {
			expect(existsSync(path.join(pluginDir, moduleName))).toBe(true);
		}

		const source = readFileSync(hookPath, "utf-8");
		expect(source).toContain('from "./session-helpers"');
		expect(source).toContain('from "./tool-before"');
		expect(source).toContain('from "./tool-after"');
		expect(source).toContain('from "./background-completion"');
		expect(source).toContain('from "./session-lifecycle"');
		expect(source).toContain('from "./chat-message"');
		expect(source).toContain('from "./settings-cache"');

		const lineCount = source.split(/\r?\n/).length;
		expect(lineCount).toBeLessThan(650);
	});

	test("ask-gate explicit confirm handling remains strict and one-shot", async () => {
		const tmpRoot = mkdtempSync(
			path.join(os.tmpdir(), "pai-cc-hooks-modularity-ask-"),
		);
		const previousRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

		try {
			process.env.PAI_CC_HOOKS_CONFIG_ROOT = tmpRoot;

			const hooksDir = path.resolve(import.meta.dir, "..", "..", "hooks");
			const securityHook = path.join(hooksDir, "SecurityValidator.hook.ts");
			const paiDir = path.resolve(import.meta.dir, "..", "..");

			writeJson(path.join(tmpRoot, "settings.json"), {
				env: {
					PAI_DIR: paiDir,
				},
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: securityHook }],
						},
					],
				},
			});

			__resetPaiCcHooksSettingsCacheForTests();
			const hooks = createPaiClaudeHooks({ ctx: {} });

			const input = {
				tool: "bash",
				sessionID: "ses_modularity",
				callID: "call_modularity",
				args: {
					command: "git reset --hard",
					description: "trigger confirm",
				},
			};

			const output: Record<string, unknown> = {
				args: { ...(input.args as Record<string, unknown>) },
			};

			let firstError = "";
			try {
				await hooks["tool.execute.before"](input, output);
				throw new Error("Expected first ask-gate block");
			} catch (error) {
				firstError = error instanceof Error ? error.message : String(error);
			}

			expect(firstError).toContain("Blocked pending confirmation");
			const firstConfirmId = extractConfirmId(firstError);

			await hooks["chat.message"](
				{
					sessionID: "ses_modularity",
					prompt: `PAI_CONFIRM ${firstConfirmId} extra`,
					parts: [
						{ type: "text", text: `PAI_CONFIRM ${firstConfirmId} extra` },
					],
				},
				{},
			);

			let malformedConfirmError = "";
			try {
				await hooks["tool.execute.before"](input, output);
				throw new Error("Expected malformed confirmation to stay blocked");
			} catch (error) {
				malformedConfirmError =
					error instanceof Error ? error.message : String(error);
			}

			expect(malformedConfirmError).toContain("Blocked pending confirmation");
			const validConfirmId = extractConfirmId(malformedConfirmError);

			await hooks["chat.message"](
				{
					sessionID: "ses_modularity",
					prompt: `pai_confirm ${validConfirmId}`,
					parts: [{ type: "text", text: `pai_confirm ${validConfirmId}` }],
				},
				{},
			);

			await hooks["tool.execute.before"](input, output);

			let oneShotError = "";
			try {
				await hooks["tool.execute.before"](input, output);
				throw new Error("Expected one-shot allowance to be consumed");
			} catch (error) {
				oneShotError = error instanceof Error ? error.message : String(error);
			}

			expect(oneShotError).toContain("Blocked pending confirmation");
		} finally {
			restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", previousRoot);
			rmSync(tmpRoot, { recursive: true, force: true });
			__resetPaiCcHooksSettingsCacheForTests();
		}
	});

	test("tool.execute.before still evaluates PreToolUse against output.args", async () => {
		const tmpRoot = mkdtempSync(
			path.join(os.tmpdir(), "pai-cc-hooks-modularity-before-"),
		);
		const previousRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

		try {
			const hookScriptPath = path.join(tmpRoot, "pre-tool-use-hook.cjs");
			writeFileSync(
				hookScriptPath,
				[
					'const fs = require("node:fs");',
					'const input = JSON.parse(fs.readFileSync(0, "utf8"));',
					"const command = input?.tool_input?.command;",
					"if (command === \"echo output\") {",
					"  process.stdout.write(JSON.stringify({",
					"    hookSpecificOutput: {",
					'      hookEventName: "PreToolUse",',
					'      permissionDecision: "allow",',
					"      updatedInput: { command: \"echo changed\" },",
					"    },",
					"  }));",
					"}",
				].join("\n"),
				"utf8",
			);

			process.env.PAI_CC_HOOKS_CONFIG_ROOT = tmpRoot;
			writeJson(path.join(tmpRoot, "settings.json"), {
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [
								{
									type: "command",
									command: `${process.execPath} "${hookScriptPath}"`,
								},
							],
						},
					],
				},
			});

			__resetPaiCcHooksSettingsCacheForTests();
			const hooks = createPaiClaudeHooks({ ctx: {} });
			const output = {
				args: { command: "echo output" },
			};

			await hooks["tool.execute.before"](
				{
					tool: "bash",
					sessionID: "ses_before_contract",
					callID: "call_before_contract",
					args: { command: "echo payload" },
				},
				output,
			);

			expect(output.args.command).toBe("echo changed");
		} finally {
			restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", previousRoot);
			rmSync(tmpRoot, { recursive: true, force: true });
			__resetPaiCcHooksSettingsCacheForTests();
		}
	});
});
