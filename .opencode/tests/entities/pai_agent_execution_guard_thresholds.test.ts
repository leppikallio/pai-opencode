import { describe, expect, test } from "bun:test";

import { shouldAskForForegroundTask } from "../../plugins/pai-cc-hooks/claude/agent-execution-guard";
import { executePreToolUseHooks } from "../../plugins/pai-cc-hooks/claude/pre-tool-use";
import type { ClaudeHooksConfig } from "../../plugins/pai-cc-hooks/claude/types";

describe("AgentExecutionGuard thresholds", () => {
  test("allows explore without ask", () => {
    expect(
      shouldAskForForegroundTask({
        subagent_type: "explore",
        prompt: "Timing: STANDARD",
      }),
    ).toBe(false);
  });

  test("asks for STANDARD", () => {
    expect(
      shouldAskForForegroundTask({
        subagent_type: "Engineer",
        prompt: "Timing: STANDARD",
      }),
    ).toBe(true);
  });

  test("allows FAST", () => {
    expect(
      shouldAskForForegroundTask({
        subagent_type: "Engineer",
        prompt: "Timing: FAST",
      }),
    ).toBe(false);
  });

  test("asks for DEEP", () => {
    expect(
      shouldAskForForegroundTask({
        subagent_type: "Engineer",
        prompt: "Timing: DEEP",
      }),
    ).toBe(true);
  });

  test("asks when prompt exceeds 800 characters", () => {
    expect(
      shouldAskForForegroundTask({
        subagent_type: "Engineer",
        prompt: "x".repeat(801),
      }),
    ).toBe(true);
  });

  test("asks when prompt contains long-work keyword", () => {
    expect(
      shouldAskForForegroundTask({
        subagent_type: "Engineer",
        prompt: "Please investigate this regression.",
      }),
    ).toBe(true);
  });
});

describe("executePreToolUseHooks task foreground guard", () => {
  test("allows when run_in_background is true and no hooks match", async () => {
    const config: ClaudeHooksConfig = { PreToolUse: [] };

    const result = await executePreToolUseHooks(
      {
        sessionId: "s",
        toolName: "task",
        toolInput: {
          run_in_background: true,
          subagent_type: "Engineer",
          prompt: "Timing: STANDARD",
        },
        cwd: process.cwd(),
      },
      config,
      null,
      {},
    );

    expect(result.decision).toBe("allow");
  });

  test("asks when foreground task prompt is Timing: STANDARD", async () => {
    const config: ClaudeHooksConfig = { PreToolUse: [] };

    const result = await executePreToolUseHooks(
      {
        sessionId: "s",
        toolName: "task",
        toolInput: {
          run_in_background: false,
          subagent_type: "Engineer",
          prompt: "Timing: STANDARD",
        },
        cwd: process.cwd(),
      },
      config,
      null,
      {},
    );

    expect(result.decision).toBe("ask");
  });
});
