import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { emitInterrupt, resolveInterrupt } from "../../hooks/lib/cmux-attention";
import {
  __testOnlyResetCmuxCliState,
  __testOnlySetCmuxCliExec,
} from "../../plugins/pai-cc-hooks/shared/cmux-cli";
import { createQueuedCmuxCliExecStub } from "../helpers/cmux-cli-exec-stub";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

type JsonRecord = Record<string, unknown>;

type HookRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function withEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

function cleanupPath(targetPath: string): void {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {}
}

async function runHook(args: {
  script: string;
  payload: JsonRecord;
  env: Record<string, string | undefined>;
}): Promise<HookRunResult> {
  const proc = Bun.spawn({
    cmd: ["bun", args.script],
    cwd: repoRoot,
    env: withEnv(args.env),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(JSON.stringify(args.payload));
  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("question attention lifecycle hooks", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
  });

  afterEach(() => {
    __testOnlyResetCmuxCliState();
  });

  test("pending then answered emits attention lifecycle and keeps stdout contract", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pai-question-attention-runtime-"));
    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 2, stdout: "", stderr: "target failed", signal: null, timedOut: false },
        { exitCode: 3, stdout: "", stderr: "surface failed", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 2, stdout: "", stderr: "target failed", signal: null, timedOut: false },
        { exitCode: 3, stdout: "", stderr: "surface failed", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
      ],
      { onEmpty: "throw" },
    );

    fs.mkdirSync(path.join(runtimeRoot, "hooks"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, "skills"), { recursive: true });

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousAttentionEnabled = process.env.PAI_CMUX_ATTENTION_ENABLED;
    const previousProgressEnabled = process.env.PAI_CMUX_PROGRESS_ENABLED;
    const previousFlashOnP0 = process.env.PAI_CMUX_FLASH_ON_P0;

    __testOnlySetCmuxCliExec(stub.exec);

    delete process.env.CMUX_SOCKET_PATH;
    process.env.CMUX_WORKSPACE_ID = "workspace-123";
    process.env.CMUX_SURFACE_ID = "surface-123";
    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_ATTENTION_ENABLED = "1";
    process.env.PAI_CMUX_PROGRESS_ENABLED = "1";
    process.env.PAI_CMUX_FLASH_ON_P0 = "0";

    const hookEnv = {
      CMUX_WORKSPACE_ID: "workspace-123",
      CMUX_SURFACE_ID: "surface-123",
      OPENCODE_ROOT: runtimeRoot,
      PAI_CMUX_ATTENTION_ENABLED: "0",
      PAI_CMUX_FLASH_ON_P0: "0",
    };

    try {
      const pending = await runHook({
        script: ".opencode/hooks/SetQuestionTab.hook.ts",
        env: hookEnv,
        payload: {
          session_id: "ses_question_lifecycle",
          hook_event_name: "PreToolUse",
          tool_input: {
            questions: [{ header: "Need deploy approval" }],
          },
        },
      });

      const resolved = await runHook({
        script: ".opencode/hooks/QuestionAnswered.hook.ts",
        env: hookEnv,
        payload: {
          session_id: "ses_question_lifecycle",
          hook_event_name: "PostToolUse",
          tool_name: "Question",
          tool_input: {},
        },
      });

      expect(pending.exitCode).toBe(0);
      expect(pending.stderr).toBe("");
      expect(pending.stdout).toBe('{"continue": true}\n');

      expect(resolved.exitCode).toBe(0);
      expect(resolved.stderr).toBe("");
      expect(resolved.stdout).toBe('{"continue": true}\n');

      await emitInterrupt({
        eventKey: "QUESTION_PENDING",
        sessionId: "ses_question_lifecycle",
        reasonShort: "Need deploy approval",
      });

      await resolveInterrupt({
        eventKey: "QUESTION_RESOLVED",
        sessionId: "ses_question_lifecycle",
        reasonShort: "Answered",
      });

      expect(stub.calls.map((call) => call.args)).toEqual([
        [
          "notify",
          "--title",
          "PAI",
          "--subtitle",
          "Question P0",
          "--body",
          "Need deploy approval",
          "--workspace",
          "workspace-123",
          "--surface",
          "surface-123",
        ],
        [
          "notify",
          "--title",
          "PAI",
          "--subtitle",
          "Question P0",
          "--body",
          "Need deploy approval",
          "--surface",
          "surface-123",
        ],
        ["notify", "--title", "PAI", "--subtitle", "Question P0", "--body", "Need deploy approval"],
        ["set-status", "oc_attention", "QUESTION", "--workspace", "workspace-123"],
        ["set-status", "oc_phase", "QUESTION", "--workspace", "workspace-123"],
        ["set-progress", "1", "--label", "QUESTION", "--workspace", "workspace-123"],
        [
          "notify",
          "--title",
          "PAI",
          "--subtitle",
          "Question P2",
          "--body",
          "Answered",
          "--workspace",
          "workspace-123",
          "--surface",
          "surface-123",
        ],
        [
          "notify",
          "--title",
          "PAI",
          "--subtitle",
          "Question P2",
          "--body",
          "Answered",
          "--surface",
          "surface-123",
        ],
        ["notify", "--title", "PAI", "--subtitle", "Question P2", "--body", "Answered"],
        ["clear-status", "oc_attention", "--workspace", "workspace-123"],
        ["set-status", "oc_phase", "DONE", "--workspace", "workspace-123"],
        ["clear-progress", "--workspace", "workspace-123"],
      ]);
    } finally {
      if (previousSocketPath === undefined) {
        delete process.env.CMUX_SOCKET_PATH;
      } else {
        process.env.CMUX_SOCKET_PATH = previousSocketPath;
      }
      if (previousWorkspaceId === undefined) {
        delete process.env.CMUX_WORKSPACE_ID;
      } else {
        process.env.CMUX_WORKSPACE_ID = previousWorkspaceId;
      }
      if (previousSurfaceId === undefined) {
        delete process.env.CMUX_SURFACE_ID;
      } else {
        process.env.CMUX_SURFACE_ID = previousSurfaceId;
      }
      if (previousOpencodeRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousOpencodeRoot;
      }
      if (previousAttentionEnabled === undefined) {
        delete process.env.PAI_CMUX_ATTENTION_ENABLED;
      } else {
        process.env.PAI_CMUX_ATTENTION_ENABLED = previousAttentionEnabled;
      }
      if (previousProgressEnabled === undefined) {
        delete process.env.PAI_CMUX_PROGRESS_ENABLED;
      } else {
        process.env.PAI_CMUX_PROGRESS_ENABLED = previousProgressEnabled;
      }
      if (previousFlashOnP0 === undefined) {
        delete process.env.PAI_CMUX_FLASH_ON_P0;
      } else {
        process.env.PAI_CMUX_FLASH_ON_P0 = previousFlashOnP0;
      }
      cleanupPath(runtimeRoot);
    }
  });
});
