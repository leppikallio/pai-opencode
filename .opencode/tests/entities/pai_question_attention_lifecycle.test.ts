import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

type JsonRecord = Record<string, unknown>;

type HookRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type V2Request = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

type V2ResponseBody =
  | { ok: true; result: unknown }
  | { ok: false; error: { code?: string; message: string } };

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

async function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function cleanupPath(targetPath: string): void {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {}
}

async function startFakeCmuxServer(args: {
  socketPath: string;
  onJsonRequest?: (request: V2Request) => V2ResponseBody;
}): Promise<{ server: net.Server; capturedJson: V2Request[]; capturedLegacy: string[] }> {
  const capturedJson: V2Request[] = [];
  const capturedLegacy: string[] = [];

  const server = net.createServer((connection) => {
    connection.setEncoding("utf8");
    let buffer = "";

    connection.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n");
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const trimmed = line.trim();

        if (!trimmed) {
          continue;
        }

        if (trimmed.startsWith("{")) {
          const request = JSON.parse(trimmed) as V2Request;
          capturedJson.push(request);
          const response =
            args.onJsonRequest?.(request) ??
            ({ ok: true as const, result: { created: true } } satisfies V2ResponseBody);
          connection.write(JSON.stringify({ id: request.id, ...response }) + "\n");
          continue;
        }

        capturedLegacy.push(trimmed);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(args.socketPath, resolve));
  return { server, capturedJson, capturedLegacy };
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
  test("pending then answered emits attention lifecycle and keeps stdout contract", async () => {
    const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "pai-question-attention-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pai-question-attention-runtime-"));
    const socketPath = path.join(socketDir, "cmux.sock");

    fs.mkdirSync(path.join(runtimeRoot, "hooks"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, "skills"), { recursive: true });

    const { server, capturedJson, capturedLegacy } = await startFakeCmuxServer({
      socketPath,
      onJsonRequest: (request) => {
        if (
          request.method === "notification.create_for_target" ||
          request.method === "notification.create_for_surface"
        ) {
          return { ok: false, error: { code: "NO_TARGET", message: "target missing" } };
        }

        return { ok: true, result: { created: true } };
      },
    });

    const hookEnv = {
      CMUX_SOCKET_PATH: socketPath,
      CMUX_WORKSPACE_ID: "workspace-123",
      CMUX_SURFACE_ID: "surface-123",
      OPENCODE_ROOT: runtimeRoot,
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

      expect(capturedJson.map((entry) => entry.method)).toEqual([
        "notification.create_for_target",
        "notification.create_for_surface",
        "notification.create",
        "notification.create_for_target",
        "notification.create_for_surface",
        "notification.create",
      ]);

      expect((capturedJson[2]?.params.subtitle as string | undefined) ?? "").toBe("Question P0");
      expect((capturedJson[2]?.params.body as string | undefined) ?? "").toBe("Need deploy approval");
      expect((capturedJson[5]?.params.subtitle as string | undefined) ?? "").toBe("Question P2");

      expect(capturedLegacy).toContain("set_status oc_attention QUESTION");
      expect(capturedLegacy).toContain("set_progress 1 QUESTION");
      expect(capturedLegacy).toContain("clear_status oc_attention");
      expect(capturedLegacy).toContain("clear_progress");
    } finally {
      await closeServer(server);
      cleanupPath(socketPath);
      cleanupPath(socketDir);
      cleanupPath(runtimeRoot);
    }
  });
});
