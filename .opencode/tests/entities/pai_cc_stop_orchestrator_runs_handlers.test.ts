import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

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

async function runStopOrchestrator(args: {
  paiDir: string;
  transcriptPath: string;
  sessionId: string;
  envOverrides?: Record<string, string | undefined>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const env = withEnv({
    PAI_DIR: args.paiDir,
    PAI_DISABLE_VOICE: "1",
    PAI_NO_NETWORK: undefined,
    CMUX_SOCKET_PATH: "",
    PAI_VOICE_NOTIFY_URL: undefined,
    PAI_VOICE_SERVER_URL: undefined,
    ...args.envOverrides,
  });

  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/StopOrchestrator.hook.ts"],
    cwd: repoRoot,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(
    JSON.stringify({
      session_id: args.sessionId,
      transcript_path: args.transcriptPath,
      hook_event_name: "Stop",
    }),
  );
  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

describe("StopOrchestrator hook", () => {
  test("runs handlers and exits cleanly with voice disabled", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-stop-orchestrator-pai-"));
    const transcriptDir = path.join(paiDir, "transcripts");
    const transcriptPath = path.join(transcriptDir, "session.jsonl");
    const smokeLogPath = path.join(paiDir, "MEMORY", "WORK", "pai-cc-hooks-smoke.jsonl");

    try {
      await fs.mkdir(transcriptDir, { recursive: true });
      await fs.writeFile(
        path.join(paiDir, "settings.json"),
        `${JSON.stringify({ daidentity: { name: "Marvin" } }, null, 2)}\n`,
        "utf8",
      );

      await fs.writeFile(
        transcriptPath,
        `${JSON.stringify({
          type: "assistant",
          message: {
            content: "📋 SUMMARY: Hook test response\n🗣️ Marvin: Completed stop orchestrator handler test.",
          },
        })}\n`,
        "utf8",
      );

      const result = await runStopOrchestrator({
        paiDir,
        transcriptPath,
        sessionId: "ses_stop_orchestrator_test",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("[StopOrchestrator] Fatal error");
      expect(existsSync(smokeLogPath)).toBe(false);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("ignores traversal transcript path and exits cleanly", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-stop-orchestrator-traversal-"));
    const secretMarker = "TRAVERSAL_SECRET_MARKER";

    try {
      const result = await runStopOrchestrator({
        paiDir,
        transcriptPath: "../secrets",
        sessionId: "ses_stop_orchestrator_traversal",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("[TranscriptParser] Error parsing transcript");
      expect(result.stderr).not.toContain(secretMarker);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("skips voice fetch when PAI_NO_NETWORK is enabled", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-stop-orchestrator-no-network-"));
    const transcriptDir = path.join(paiDir, "transcripts");
    const transcriptPath = path.join(transcriptDir, "session.jsonl");

    try {
      await fs.mkdir(transcriptDir, { recursive: true });
      await fs.writeFile(
        path.join(paiDir, "settings.json"),
        `${JSON.stringify({ daidentity: { name: "Marvin", voiceId: "voice-test" } }, null, 2)}\n`,
        "utf8",
      );

      await fs.writeFile(
        transcriptPath,
        `${JSON.stringify({
          type: "assistant",
          message: {
            content: "📋 SUMMARY: Hook test response\n🗣️ Marvin: Network gate should skip voice request.",
          },
        })}\n`,
        "utf8",
      );

      const result = await runStopOrchestrator({
        paiDir,
        transcriptPath,
        sessionId: "ses_stop_orchestrator_no_network",
        envOverrides: {
          PAI_DISABLE_VOICE: undefined,
          PAI_NO_NETWORK: "1",
          PAI_VOICE_NOTIFY_URL: "http://127.0.0.1:1/notify",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("[VoiceNotification] Skipping network request: PAI_NO_NETWORK=1");
      expect(result.stderr.toLowerCase()).not.toContain("fetch");
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
