import { describe, expect, test } from "bun:test";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

async function runHook(args: {
  script: string;
  payload: Record<string, unknown>;
}): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", args.script],
    cwd: repoRoot,
    env: {
      ...process.env,
      CMUX_SOCKET_PATH: "",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(JSON.stringify(args.payload));
  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stderr, stdout };
}

describe("terminal UX hooks with missing cmux socket", () => {
  test("hooks no-op and exit cleanly", async () => {
    const hookRuns = [
      {
        script: ".opencode/hooks/SetQuestionTab.hook.ts",
        payload: {
          session_id: "ses_no_cmux",
          hook_event_name: "PreToolUse",
          tool_input: {
            questions: [{ header: "Need approval" }],
          },
        },
      },
      {
        script: ".opencode/hooks/QuestionAnswered.hook.ts",
        payload: {
          session_id: "ses_no_cmux",
          hook_event_name: "PostToolUse",
          tool_name: "Question",
          tool_input: {},
        },
      },
      {
        script: ".opencode/hooks/UpdateTabTitle.hook.ts",
        payload: {
          session_id: "ses_no_cmux",
          hook_event_name: "UserPromptSubmit",
          prompt: "Summarize this branch state",
        },
      },
      {
        script: ".opencode/hooks/VoiceGate.hook.ts",
        payload: {
          session_id: "ses_no_cmux",
          hook_event_name: "UserPromptSubmit",
          prompt: "hello",
        },
      },
    ];

    for (const hookRun of hookRuns) {
      const result = await runHook(hookRun);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({ continue: true });
    }
  });
});
