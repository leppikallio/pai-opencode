import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

type HookPayload = {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function runHook(args: { payload: HookPayload; opencodeRoot: string }): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/VoiceGate.hook.ts"],
    cwd: repoRoot,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      OPENCODE_ROOT: args.opencodeRoot,
    },
  });

  proc.stdin.write(JSON.stringify(args.payload));
  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stderr, stdout };
}

describe("VoiceGate hook for voice_notify", () => {
  test("main session: allows", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pai-voicegate-main-"));
    try {
      const result = await runHook({
        opencodeRoot: tmpRoot,
        payload: {
          session_id: "root-session",
          tool_name: "VoiceNotify",
          tool_input: { message: "hello" },
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({ continue: true });
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("subagent session: strips message (silent no-op)", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pai-voicegate-subagent-"));
    try {
      const statePath = path.join(tmpRoot, "MEMORY", "STATE", "background-tasks.json");
      writeJson(statePath, {
        version: 1,
        updatedAtMs: Date.now(),
        notifiedTaskIds: {},
        duplicateBySession: {},
        backgroundTasks: {
          bg_S1: {
            task_id: "bg_S1",
            child_session_id: "S1",
            parent_session_id: "P1",
            launched_at_ms: Date.now(),
            updated_at_ms: Date.now(),
          },
        },
      });

      const result = await runHook({
        opencodeRoot: tmpRoot,
        payload: {
          session_id: "S1",
          tool_name: "VoiceNotify",
          tool_input: { message: "hello" },
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const parsed = JSON.parse(result.stdout) as any;
      expect(parsed.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
      expect(parsed.hookSpecificOutput?.permissionDecision).toBe("allow");
      expect(parsed.hookSpecificOutput?.updatedInput?.message).toBe("");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
