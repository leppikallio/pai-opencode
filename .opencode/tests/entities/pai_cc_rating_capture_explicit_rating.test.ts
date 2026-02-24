import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const explicitTruePositives = [
  { prompt: "8", rating: 8 },
  { prompt: "8 - looks good", rating: 8, comment: "looks good" },
  { prompt: "8: looks good", rating: 8, comment: "looks good" },
  { prompt: "8/10", rating: 8 },
  { prompt: "10!", rating: 10 },
  { prompt: "9 excellent", rating: 9, comment: "excellent" },
];

const explicitFalsePositives = ["8pm meeting", "8am standup", "8.5 great", "10x better"];

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

function countOccurrences(value: string, needle: string): number {
  return value.match(new RegExp(needle, "g"))?.length ?? 0;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
    session_id: args.sessionId ?? "session-explicit-1",
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

describe("RatingCapture explicit rating port", () => {
  test("parses supported explicit rating forms", async () => {
    for (const candidate of explicitTruePositives) {
      const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rating-capture-hook-"));
      const ratingsFile = path.join(paiDir, "MEMORY", "LEARNING", "SIGNALS", "ratings.jsonl");

      try {
        const { exitCode, stderr } = await runRatingCaptureHook({
          paiDir,
          prompt: candidate.prompt,
          sessionId: `session-positive-${candidate.prompt}`,
        });

        expect(exitCode).toBe(0);
        expect(stderr).toBe("");

        const lines = (await fs.readFile(ratingsFile, "utf-8")).trim().split("\n").filter(Boolean);
        expect(lines.length).toBe(1);

        const entry = JSON.parse(lines[0]) as Record<string, unknown>;
        expect(entry.rating).toBe(candidate.rating);
        expect(entry.source).toBe("explicit");

        if (candidate.comment) {
          expect(entry.comment).toBe(candidate.comment);
        } else {
          expect(entry.comment).toBeUndefined();
        }
      } finally {
        await fs.rm(paiDir, { recursive: true, force: true });
      }
    }
  });

  test("writes explicit rating and emits user-prompt-submit reminder", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rating-capture-hook-"));
    const signalsDir = path.join(paiDir, "MEMORY", "LEARNING", "SIGNALS");
    const ratingsFile = path.join(signalsDir, "ratings.jsonl");

    await fs.mkdir(signalsDir, { recursive: true });

    try {
      const { exitCode, stderr, stdout } = await runRatingCaptureHook({
        paiDir,
        prompt: "8 - looks good",
      });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(countOccurrences(stdout, "<user-prompt-submit-hook>")).toBe(1);
      expect(countOccurrences(stdout, "</user-prompt-submit-hook>")).toBe(1);

      const content = await fs.readFile(ratingsFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(1);

      const entry = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(entry.rating).toBe(8);
      expect(entry.source).toBe("explicit");
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("ignores known false-positive patterns and does not create or append ratings", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-rating-capture-hook-"));
    const signalsDir = path.join(paiDir, "MEMORY", "LEARNING", "SIGNALS");
    const ratingsFile = path.join(signalsDir, "ratings.jsonl");

    try {
      for (const prompt of explicitFalsePositives) {
        const { exitCode, stderr } = await runRatingCaptureHook({
          paiDir,
          prompt,
          sessionId: `session-no-create-${prompt}`,
        });

        expect(exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(await fileExists(ratingsFile)).toBe(false);
      }

      await fs.mkdir(signalsDir, { recursive: true });
      const seededContent = `${JSON.stringify({
        timestamp: new Date().toISOString(),
        rating: 7,
        session_id: "seed-session",
        source: "explicit",
        comment: "seed",
      })}\n`;
      await fs.writeFile(ratingsFile, seededContent, "utf-8");

      for (const prompt of explicitFalsePositives) {
        const { exitCode, stderr } = await runRatingCaptureHook({
          paiDir,
          prompt,
          sessionId: `session-no-append-${prompt}`,
        });

        expect(exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(await fs.readFile(ratingsFile, "utf-8")).toBe(seededContent);
      }
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
