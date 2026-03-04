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

function sessionNamesPath(paiDir: string): string {
  return path.join(paiDir, "MEMORY", "STATE", "session-names.json");
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

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

async function readSessionNames(paiDir: string): Promise<{
  raw: string;
  parsed: Record<string, string>;
}> {
  const raw = await fs.readFile(sessionNamesPath(paiDir), "utf8");
  return {
    raw,
    parsed: JSON.parse(raw) as Record<string, string>,
  };
}

describe("SessionAutoName hook", () => {
  test("creates session-names.json and writes fallback name for a session", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-session-autoname-"));

    try {
      const result = await runSessionAutoNameHook({
        paiDir,
        payload: {
          session_id: "session-create",
          prompt: "Kaleidoscope telemetry migration planning",
        },
        env: {
          PAI_DISABLE_SESSION_NAMING_INFERENCE: "1",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");

      const names = await readSessionNames(paiDir);
      expect(() => JSON.parse(names.raw)).not.toThrow();
      expect(names.parsed["session-create"]).toBe("Kaleidoscope Session");
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("accepts payload.sessionId and writes fallback name", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-session-autoname-"));

    try {
      const result = await runSessionAutoNameHook({
        paiDir,
        payload: {
          sessionId: "session-camel",
          prompt: "Aurora incident triage planning",
        },
        env: {
          PAI_DISABLE_SESSION_NAMING_INFERENCE: "1",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");

      const names = await readSessionNames(paiDir);
      expect(() => JSON.parse(names.raw)).not.toThrow();
      expect(names.parsed["session-camel"]).toBe("Aurora Session");
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("second run keeps existing name and exits with inference disabled", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-session-autoname-"));

    try {
      const firstRun = await runSessionAutoNameHook({
        paiDir,
        payload: {
          session_id: "session-keep",
          prompt: "Initial generated title input",
        },
        env: {
          PAI_DISABLE_SESSION_NAMING_INFERENCE: "1",
        },
      });

      expect(firstRun.exitCode).toBe(0);

      const beforeSecondRun = await readSessionNames(paiDir);
      const existingName = beforeSecondRun.parsed["session-keep"];
      expect(existingName).toBeTruthy();

      const secondRun = await runSessionAutoNameHook({
        paiDir,
        payload: {
          session_id: "session-keep",
          prompt: "Completely different request text",
        },
        env: {
          PAI_DISABLE_SESSION_NAMING_INFERENCE: "1",
        },
      });

      expect(secondRun.exitCode).toBe(0);

      const afterSecondRun = await readSessionNames(paiDir);
      expect(afterSecondRun.parsed["session-keep"]).toBe(existingName);
      expect(afterSecondRun.raw).toBe(beforeSecondRun.raw);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("updates existing name when customTitle is provided", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-session-autoname-"));

    try {
      const namesPath = sessionNamesPath(paiDir);
      await fs.mkdir(path.dirname(namesPath), { recursive: true });
      await fs.writeFile(
        namesPath,
        `${JSON.stringify({ "session-rename": "Old Name" }, null, 2)}\n`,
        "utf8",
      );

      const result = await runSessionAutoNameHook({
        paiDir,
        payload: {
          session_id: "session-rename",
          prompt: "Prompt should not win over custom title",
          customTitle: "Manual Rename",
        },
        env: {
          PAI_DISABLE_SESSION_NAMING_INFERENCE: "1",
        },
      });

      expect(result.exitCode).toBe(0);

      const names = await readSessionNames(paiDir);
      expect(names.parsed["session-rename"]).toBe("Manual Rename");
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });

  test("uses projects index customTitle only when scan gate is enabled", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-session-autoname-"));

    try {
      const indexDir = path.join(paiDir, "projects", "alpha");
      const indexPath = path.join(indexDir, "sessions-index.json");
      await fs.mkdir(indexDir, { recursive: true });
      await fs.writeFile(
        indexPath,
        JSON.stringify(
          [
            {
              sessionId: "session-index-off",
              customTitle: "Indexed Off",
            },
            {
              sessionId: "session-index-on",
              customTitle: "Indexed On",
            },
          ],
          null,
          2,
        ),
        "utf8",
      );

      const defaultRun = await runSessionAutoNameHook({
        paiDir,
        payload: {
          session_id: "session-index-off",
          prompt: "Harbor telemetry baseline",
        },
        env: {
          PAI_DISABLE_SESSION_NAMING_INFERENCE: "1",
        },
      });

      expect(defaultRun.exitCode).toBe(0);

      const gatedRun = await runSessionAutoNameHook({
        paiDir,
        payload: {
          session_id: "session-index-on",
          prompt: "Prompt text should not be used when index title exists",
        },
        env: {
          PAI_DISABLE_SESSION_NAMING_INFERENCE: "1",
          PAI_SESSION_AUTONAME_SCAN_INDEX: "1",
        },
      });

      expect(gatedRun.exitCode).toBe(0);

      const names = await readSessionNames(paiDir);
      expect(names.parsed["session-index-off"]).toBe("Harbor Session");
      expect(names.parsed["session-index-on"]).toBe("Indexed On");
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
