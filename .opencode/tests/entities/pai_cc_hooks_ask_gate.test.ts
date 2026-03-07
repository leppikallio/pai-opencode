import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  __resetPaiCcHooksSettingsCacheForTests,
  createPaiClaudeHooks,
} from "../../plugins/pai-cc-hooks/hook";

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

describe("pai-cc-hooks ask gate", () => {
  test("ask decision blocks and can be confirmed once", async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "pai-cc-hooks-ask-"));
    const prevConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

    try {
      // Point hooks config loader at this temp root.
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

      // The hooks layer injects OPENCODE_ROOT=tmpRoot. Provide a test-local
      // security patterns override so the SecurityValidator produces an `ask`
      // decision for a non-destructive command.
      const patternsDir = path.join(
        tmpRoot,
        "skills",
        "PAI",
        "USER",
        "PAISECURITYSYSTEM",
      );
      mkdirSync(patternsDir, { recursive: true });
      writeFileSync(
        path.join(patternsDir, "patterns.yaml"),
        [
          "---",
          'version: "1.0"',
          "",
          "bash:",
          "  confirm:",
          '    - pattern: "echo block_test"',
          '      reason: "Test-only ask-gate trigger"',
          "",
          "paths:",
          "  zeroAccess:",
          "  readOnly:",
          "  confirmWrite:",
          "  noDelete:",
          "",
        ].join("\n"),
        "utf-8",
      );

      __resetPaiCcHooksSettingsCacheForTests();
      const hooks = createPaiClaudeHooks({ ctx: {} });

      const input = {
        tool: "bash",
        sessionID: "ses_test",
        callID: "call_test",
        args: {
          command: "echo block_test",
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
      rmSync(tmpRoot, { recursive: true, force: true });
      __resetPaiCcHooksSettingsCacheForTests();
    }
  });
});
