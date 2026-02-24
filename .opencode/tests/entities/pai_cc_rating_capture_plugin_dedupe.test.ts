import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { captureRating } from "../../plugins/handlers/rating-capture";

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
      continue;
    }

    env[key] = value;
  }

  return env;
}

async function runRatingCaptureHook(args: {
  paiDir: string;
  prompt: string;
  sessionId?: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/RatingCapture.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      PAI_DIR: args.paiDir,
      PAI_DISABLE_IMPLICIT_SENTIMENT: "1",
      PAI_NO_NETWORK: undefined,
    }),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(JSON.stringify({
    session_id: args.sessionId ?? "session-dedupe-hook",
    prompt: args.prompt,
    transcript_path: path.join(args.paiDir, "transcript.jsonl"),
  }));
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

describe("rating-capture plugin dedupe", () => {
  test("captureRating skips duplicate explicit line written by hook", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rating-dedupe-"));
    const ratingsFile = path.join(paiDir, "MEMORY", "LEARNING", "SIGNALS", "ratings.jsonl");
    const originalPaiDir = process.env.PAI_DIR;

    try {
      process.env.PAI_DIR = paiDir;

      const hookResult = await runRatingCaptureHook({
        paiDir,
        prompt: "9 excellent",
      });

      expect(hookResult.exitCode).toBe(0);
      expect(hookResult.stderr).toBe("");

      const hookLines = (await fs.readFile(ratingsFile, "utf-8")).trim().split("\n").filter(Boolean);
      expect(hookLines.length).toBe(1);

      const pluginResult = await captureRating("9 excellent");
      expect(pluginResult.success).toBe(true);
      expect(pluginResult.rating?.rating).toBe(9);

      const finalLines = (await fs.readFile(ratingsFile, "utf-8")).trim().split("\n").filter(Boolean);
      expect(finalLines.length).toBe(1);
    } finally {
      if (originalPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = originalPaiDir;
      }

      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
