import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createSecurityPermissionAskFallback,
  mapSecurityActionToPermissionStatus,
} from "../../plugins/security";
import {
  __resetPaiCcHooksSettingsCacheForTests,
  createPaiClaudeHooks,
} from "../../plugins/pai-cc-hooks/hook";

describe("security behavior extracted from deprecated pai-unified", () => {
  test("maps security actions to permission.ask statuses", () => {
    expect(mapSecurityActionToPermissionStatus("block")).toBe("deny");
    expect(mapSecurityActionToPermissionStatus("confirm")).toBe("ask");
    expect(mapSecurityActionToPermissionStatus("allow")).toBe("allow");
  });

  test("uses ask fail-safe when validator errors", () => {
    const fallback = createSecurityPermissionAskFallback(new Error("simulated validator failure"));

    expect(fallback.status).toBe("ask");
    expect(fallback.reason).toContain("Security validator error");
    expect(fallback.reason).toContain("simulated validator failure");
  });

  test("normalizes tilde paths before PreToolUse security hooks", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pai-security-unified-extract-"));
    const previousRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

    try {
      const hookScriptPath = path.join(root, "tilde-guard.cjs");
      writeFileSync(
        hookScriptPath,
        [
          'const fs = require("node:fs");',
          'const os = require("node:os");',
          'const input = JSON.parse(fs.readFileSync(0, "utf8"));',
          'const filePath = input?.tool_input?.file_path;',
          'if (typeof filePath === "string" && filePath.startsWith(os.homedir() + "/")) {',
          "  process.stdout.write(JSON.stringify({",
          "    hookSpecificOutput: {",
          '      hookEventName: "PreToolUse",',
          '      permissionDecision: "allow",',
          "    },",
          "  }));",
          "  process.exit(0);",
          "}",
          "process.stdout.write(JSON.stringify({",
          "  hookSpecificOutput: {",
          '    hookEventName: "PreToolUse",',
          '    permissionDecision: "ask",',
          '    permissionDecisionReason: "Path was not tilde-normalized",',
          "  },",
          "}));",
        ].join("\n"),
        "utf8",
      );

      writeFileSync(
        path.join(root, "settings.json"),
        JSON.stringify(
          {
            hooks: {
              PreToolUse: [
                {
                  matcher: "Read",
                  hooks: [{ type: "command", command: `${process.execPath} "${hookScriptPath}"` }],
                },
              ],
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      process.env.PAI_CC_HOOKS_CONFIG_ROOT = root;
      __resetPaiCcHooksSettingsCacheForTests();
      const hooks = createPaiClaudeHooks({ ctx: {} });

      const output: Record<string, unknown> = {
        args: {
          filePath: "~/security-fixture.txt",
        },
      };

      await hooks["tool.execute.before"](
        {
          tool: "Read",
          sessionID: "ses_tilde_norm",
          callID: "call_tilde_norm",
        },
        output,
      );
    } finally {
      if (previousRoot === undefined) {
        delete process.env.PAI_CC_HOOKS_CONFIG_ROOT;
      } else {
        process.env.PAI_CC_HOOKS_CONFIG_ROOT = previousRoot;
      }

      __resetPaiCcHooksSettingsCacheForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
