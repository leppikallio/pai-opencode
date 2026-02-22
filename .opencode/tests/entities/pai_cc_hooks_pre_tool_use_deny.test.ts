import { describe, expect, test } from "bun:test";

import { executePreToolUseHooks } from "../../plugins/pai-cc-hooks/claude/pre-tool-use";
import type { ClaudeHooksConfig } from "../../plugins/pai-cc-hooks/claude/types";

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
});
