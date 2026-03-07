import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { executePreToolUseHooks } from "../../plugins/pai-cc-hooks/claude/pre-tool-use";
import type { ClaudeHooksConfig } from "../../plugins/pai-cc-hooks/claude/types";

function writeHookScript(scriptPath: string, bodyLines: string[]): void {
  writeFileSync(scriptPath, ["#!/usr/bin/env bun", ...bodyLines].join("\n"), "utf8");
}

function commandForScript(scriptPath: string): string {
  return `${process.execPath} ${scriptPath}`;
}

describe("executePreToolUseHooks", () => {
  test("returns deny when hook exits with code 2", async () => {
    const config: ClaudeHooksConfig = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "sh -c 'exit 2'",
            },
          ],
        },
      ],
    };

    const result = await executePreToolUseHooks(
      {
        sessionId: "s",
        toolName: "bash",
        toolInput: { command: "echo hi" },
        cwd: process.cwd(),
      },
      config,
      null,
      {},
    );

    expect(result.decision).toBe("deny");
    expect(result.reason ?? "").toContain("Hook blocked");
  });

  test("attributes decision to the actual deciding hook when a later hook blocks", async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "pai-pre-tool-attribution-"));

    try {
      const passthroughHookPath = path.join(tmpRoot, "passthrough-continue.hook.ts");
      const denyHookPath = path.join(tmpRoot, "deny-later.hook.ts");

      writeHookScript(passthroughHookPath, [
        'process.stdout.write(JSON.stringify({ continue: true }) + "\\n");',
      ]);
      writeHookScript(denyHookPath, [
        'process.stderr.write("blocked-by-second-hook\\n");',
        "process.exit(2);",
      ]);

      const config: ClaudeHooksConfig = {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: commandForScript(passthroughHookPath),
              },
              {
                type: "command",
                command: commandForScript(denyHookPath),
              },
            ],
          },
        ],
      };

      const result = await executePreToolUseHooks(
        {
          sessionId: "s",
          toolName: "bash",
          toolInput: { command: "echo hi" },
          cwd: process.cwd(),
        },
        config,
        null,
        {},
      );

      expect(result.decision).toBe("deny");
      expect(result.reason).toContain("blocked-by-second-hook");
      expect(result.hookName).toBe("deny-later.hook.ts");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("fails safe to ask when SecurityValidator returns non-JSON output", async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "pai-pre-tool-parse-fail-"));

    try {
      const securityHookPath = path.join(tmpRoot, "SecurityValidator.hook.ts");
      writeHookScript(securityHookPath, ['process.stdout.write("not-json\\n");']);

      const config: ClaudeHooksConfig = {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: commandForScript(securityHookPath),
              },
            ],
          },
        ],
      };

      const result = await executePreToolUseHooks(
        {
          sessionId: "s",
          toolName: "bash",
          toolInput: { command: "echo hi" },
          cwd: process.cwd(),
        },
        config,
        null,
        {},
      );

      expect(result.decision).toBe("ask");
      expect(result.hookName).toBe("SecurityValidator.hook.ts");
      expect(result.reason ?? "").toContain("parse");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("fails safe to ask when SecurityValidator returns empty output", async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "pai-pre-tool-empty-output-"));

    try {
      const securityHookPath = path.join(tmpRoot, "SecurityValidator.hook.ts");
      writeHookScript(securityHookPath, ["// empty output on purpose"]);

      const config: ClaudeHooksConfig = {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: commandForScript(securityHookPath),
              },
            ],
          },
        ],
      };

      const result = await executePreToolUseHooks(
        {
          sessionId: "s",
          toolName: "bash",
          toolInput: { command: "echo hi" },
          cwd: process.cwd(),
        },
        config,
        null,
        {},
      );

      expect(result.decision).toBe("ask");
      expect(result.hookName).toBe("SecurityValidator.hook.ts");
      expect(result.reason ?? "").toContain("empty");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
