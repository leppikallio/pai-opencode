import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	__resetPaiCcHooksSettingsCacheForTests,
	createPaiClaudeHooks,
} from "../../plugins/pai-cc-hooks/hook";
import {
	__resetAskGateForTests,
	buildAskGateKey,
} from "../../plugins/pai-cc-hooks/ask-gate";

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

describe("pai-cc-hooks ask gate", () => {
  test("buildAskGateKey handles circular arrays deterministically", () => {
    const circularArray: unknown[] = [];
    circularArray.push("alpha");
    circularArray.push(circularArray);

    const key1 = buildAskGateKey({
      sessionId: "ses_circular",
      toolName: "bash",
      toolInput: { payload: circularArray },
    });

    const secondCircularArray: unknown[] = [];
    secondCircularArray.push("alpha");
    secondCircularArray.push(secondCircularArray);

    const key2 = buildAskGateKey({
      sessionId: "ses_circular",
      toolName: "bash",
      toolInput: { payload: secondCircularArray },
    });

    expect(key1).toContain('"[Circular]"');
    expect(key1).toBe(key2);
  });

	test("ask decision blocks and can be confirmed once", async () => {
		const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "pai-cc-hooks-ask-"));
		const prevConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;
		const prevAskGateStatePath = process.env.PAI_CC_HOOKS_ASK_GATE_STATE_PATH;

		try {
			// Point hooks config loader at this temp root.
			process.env.PAI_CC_HOOKS_CONFIG_ROOT = tmpRoot;
			process.env.PAI_CC_HOOKS_ASK_GATE_STATE_PATH = path.join(
				tmpRoot,
				"ask-gate-state.json",
			);

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
			__resetAskGateForTests();
			const hooks = createPaiClaudeHooks({ ctx: {} });

			const input = {
				tool: "bash",
				sessionID: "ses_test",
				callID: "call_test",
				args: {
					command: "git push --force",
					description: "trigger ask gate",
				},
			};

      const output: Record<string, unknown> = {
        args: { ...(input.args as Record<string, unknown>) },
      };

      let errText = "";
      try {
        await hooks["tool.execute.before"](input, output);
        throw new Error("Expected tool.execute.before to throw");
      } catch (err) {
        errText = err instanceof Error ? err.message : String(err);
      }

      expect(errText).toContain("Blocked pending confirmation");
      expect(errText).toContain("PAI_CONFIRM");

      const match = errText.match(/PAI_CONFIRM\s+(pai_confirm_[a-z0-9]+)/);
      expect(match?.[1]).toBeTruthy();
      const confirmId = match?.[1] as string;

      // Simulate user confirmation message.
      const chatOut: Record<string, unknown> = {};
      await hooks["chat.message"](
        {
          sessionID: "ses_test",
          prompt: `PAI_CONFIRM ${confirmId}`,
          parts: [{ type: "text", text: `PAI_CONFIRM ${confirmId}` }],
        },
        chatOut,
      );

      // Retry: should be allowed once (no throw).
      await hooks["tool.execute.before"](input, output);
		} finally {
			if (prevConfigRoot === undefined) {
				delete process.env.PAI_CC_HOOKS_CONFIG_ROOT;
			} else {
				process.env.PAI_CC_HOOKS_CONFIG_ROOT = prevConfigRoot;
			}
			if (prevAskGateStatePath === undefined) {
				delete process.env.PAI_CC_HOOKS_ASK_GATE_STATE_PATH;
			} else {
				process.env.PAI_CC_HOOKS_ASK_GATE_STATE_PATH = prevAskGateStatePath;
			}
			rmSync(tmpRoot, { recursive: true, force: true });
			__resetAskGateForTests();
			__resetPaiCcHooksSettingsCacheForTests();
		}
	});
});
