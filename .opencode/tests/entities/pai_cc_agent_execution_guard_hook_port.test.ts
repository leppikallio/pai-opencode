import { describe, expect, test } from "bun:test";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

type HookPayload = {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

async function runHook(payload: HookPayload): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/AgentExecutionGuard.hook.ts"],
    cwd: repoRoot,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stderr, stdout };
}

describe("AgentExecutionGuard hook port", () => {
  test("prints warning for foreground non-fast task", async () => {
    const result = await runHook({
      tool_name: "Task",
      tool_input: {
        run_in_background: false,
        subagent_type: "Engineer",
        description: "implementation task",
        prompt: "## Scope\nTiming: STANDARD",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("<system-reminder>");
    expect(result.stdout).toContain("run_in_background");
  });

  test("stays silent when run_in_background is true", async () => {
    const result = await runHook({
      tool_name: "Task",
      tool_input: {
        run_in_background: true,
        subagent_type: "Engineer",
        prompt: "## Scope\nTiming: STANDARD",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });

  test("stays silent for explore or fast agent types", async () => {
    const exploreResult = await runHook({
      tool_name: "Task",
      tool_input: {
        run_in_background: false,
        subagent_type: "explore",
        prompt: "## Scope\nTiming: STANDARD",
      },
    });

    const fastResult = await runHook({
      tool_name: "Task",
      tool_input: {
        run_in_background: false,
        subagent_type: "fast",
        prompt: "## Scope\nTiming: STANDARD",
      },
    });

    expect(exploreResult.stdout).toBe("");
    expect(fastResult.stdout).toBe("");
  });

  test("stays silent for fast-tier models", async () => {
    const result = await runHook({
      tool_name: "Task",
      tool_input: {
        run_in_background: false,
        subagent_type: "Engineer",
        model: "haiku",
        prompt: "## Scope\nTiming: STANDARD",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });

  test("stays silent when scope timing is FAST", async () => {
    const result = await runHook({
      tool_name: "Task",
      tool_input: {
        run_in_background: false,
        subagent_type: "Engineer",
        prompt: "## Scope\nTiming: FAST",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });

  test("does not exempt when Timing: FAST appears outside first scope block", async () => {
    const result = await runHook({
      tool_name: "Task",
      tool_input: {
        run_in_background: false,
        subagent_type: "Engineer",
        prompt: "## Scope\nTiming: STANDARD\n\n## Notes\nTiming: FAST",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("<system-reminder>");
  });

  test("does not exempt model names containing nothaiku", async () => {
    const result = await runHook({
      tool_name: "Task",
      tool_input: {
        run_in_background: false,
        subagent_type: "Engineer",
        model: "model-nothaiku-v1",
        prompt: "## Scope\nTiming: STANDARD",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("<system-reminder>");
  });

  test("stays silent when payload is missing tool_name", async () => {
    const result = await runHook({
      tool_input: {
        run_in_background: false,
        subagent_type: "Engineer",
        prompt: "## Scope\nTiming: STANDARD",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });
});
