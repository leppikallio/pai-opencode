import { describe, expect, test } from "bun:test";
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

async function runSessionAutoNameHook(args: {
  paiDir: string;
  payload: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/SessionAutoName.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      // Keep tests deterministic even if host env enables index scanning.
      PAI_SESSION_AUTONAME_SCAN_INDEX: undefined,
      ...args.env,
      OPENCODE_ROOT: args.paiDir,
    }),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(JSON.stringify(args.payload));
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

describe("SessionAutoName work.json placeholder upsert", () => {
  test("first-run naming upserts placeholder work session entry", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-session-autoname-work-json-"));
    const sessionId = "session-autoname-work-json";

    try {
      const result = await runSessionAutoNameHook({
        paiDir,
        payload: {
          sessionId,
          prompt: "Kaleidoscope telemetry migration planning",
        },
        env: {
          PAI_DISABLE_SESSION_NAMING_INFERENCE: "1",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");

      const namesPath = path.join(paiDir, "MEMORY", "STATE", "session-names.json");
      const namesRaw = await fs.readFile(namesPath, "utf8");
      const names = JSON.parse(namesRaw) as Record<string, string>;
      const sessionName = names[sessionId];
      expect(sessionName).toBe("Kaleidoscope Session");

      const workJsonPath = path.join(paiDir, "MEMORY", "STATE", "work.json");
      const workJsonBackupPath = path.join(paiDir, "MEMORY", "STATE", "work.json.bak");
      await expect(fs.stat(workJsonPath)).resolves.toBeTruthy();
      await expect(fs.stat(workJsonBackupPath)).resolves.toBeTruthy();

      const workJsonRaw = await fs.readFile(workJsonPath, "utf8");

      const workState = JSON.parse(workJsonRaw) as {
        sessions?: Record<
          string,
          {
            sessionUUID?: string;
            source?: string;
            task?: string;
            phase?: string;
            mode?: string;
            criteria?: unknown[];
          }
        >;
      };

      const matchingSessions = Object.entries(workState.sessions ?? {}).filter(
        ([, entry]) => entry.sessionUUID === sessionId,
      );

      expect(matchingSessions).toHaveLength(1);

      const [targetKey, entry] = matchingSessions[0] ?? [];
      expect(targetKey).toBe(`session-${sessionId}`);
      expect(entry?.sessionUUID).toBe(sessionId);
      expect(entry?.source).toBe("placeholder");
      expect(entry?.task).toBe(sessionName);
      expect(entry?.phase).toBe("starting");
      expect(entry?.mode).toBe("interactive");
      expect(entry?.criteria).toEqual([]);

      // Second run must be a no-op: session name already exists -> no work.json writes.
      const secondRun = await runSessionAutoNameHook({
        paiDir,
        payload: {
          sessionId,
          prompt: "Completely different request text",
        },
        env: {
          PAI_DISABLE_SESSION_NAMING_INFERENCE: "1",
        },
      });

      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stdout).toBe("");
      expect(secondRun.stderr).toBe("");
      expect(await fs.readFile(namesPath, "utf8")).toBe(namesRaw);
      expect(await fs.readFile(workJsonPath, "utf8")).toBe(workJsonRaw);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
