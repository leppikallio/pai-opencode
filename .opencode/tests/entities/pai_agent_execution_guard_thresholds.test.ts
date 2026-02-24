import { describe, expect, test } from "bun:test";

import { shouldAskForForegroundTask } from "../../plugins/pai-cc-hooks/claude/agent-execution-guard";

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
});
