import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	__resetPaiCcHooksSettingsCacheForTests,
	createPaiClaudeHooks,
} from "../../plugins/pai-cc-hooks/hook";
import { handleToolExecuteBefore } from "../../plugins/pai-cc-hooks/tool-before";

function createConfigRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "pai-cc-hooks-tool-before-"));
  mkdirSync(path.join(root, "config"), { recursive: true });
  return root;
}

async function withConfigRoot<T>(root: string, run: () => Promise<T>): Promise<T> {
  const previousRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;
  process.env.PAI_CC_HOOKS_CONFIG_ROOT = root;

  try {
    return await run();
  } finally {
    if (previousRoot === undefined) {
      delete process.env.PAI_CC_HOOKS_CONFIG_ROOT;
    } else {
      process.env.PAI_CC_HOOKS_CONFIG_ROOT = previousRoot;
    }
  }
}

describe("tool.execute.before", () => {
  test("uses output.args as PreToolUse tool_input source", async () => {
    const root = createConfigRoot();
    const hookScriptPath = path.join(root, "pre-tool-use-hook.cjs");

    writeFileSync(
      hookScriptPath,
      [
        'const fs = require("node:fs");',
        'const input = JSON.parse(fs.readFileSync(0, "utf8"));',
        "const command = input?.tool_input?.command;",
        "if (command === \"echo hi\") {",
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

    writeFileSync(
      path.join(root, "settings.json"),
      JSON.stringify(
        {
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
        },
        null,
        2,
      ),
      "utf8",
    );

	await withConfigRoot(root, async () => {
		__resetPaiCcHooksSettingsCacheForTests();
		const hooks = createPaiClaudeHooks({ ctx: {} });
		const executeArgs: Record<string, unknown> = { command: "echo hi" };
		const output: { args: Record<string, unknown> } = {
			args: executeArgs,
		};

		await hooks["tool.execute.before"](
			{
				tool: "bash",
				sessionID: "session-1",
				callID: "call-1",
			},
			output,
		);

		expect(executeArgs.command).toBe("echo changed");
		expect(output.args.command).toBe("echo changed");
		__resetPaiCcHooksSettingsCacheForTests();
	});
	});

	test("preserves executable args when rewrite returns the same object reference", async () => {
		const executeArgs: Record<string, unknown> = {
			command: "git status",
			workdir: "/tmp/demo",
			description: "Runs git status",
		};
		const output: { args: Record<string, unknown> } = { args: executeArgs };

		await handleToolExecuteBefore({
			input: {
				tool: "bash",
				sessionID: "session-same-ref",
				callID: "call-same-ref",
			},
			output,
			config: null,
			cwd: "/tmp/demo",
			deps: {
				async maybeRewriteBashToolInputWithRtk() {
					return executeArgs;
				},
			},
		});

		expect(executeArgs.command).toBe("git status");
		expect(executeArgs.workdir).toBe("/tmp/demo");
		expect(output.args.command).toBe("git status");
	});
});
