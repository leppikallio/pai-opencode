import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisFileDir, "..", "..", "..");

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

function makePrd(slug: string): string {
  return `---
task: Corruption recovery test
slug: ${slug}
effort: standard
phase: verify
progress: 1/1
mode: interactive
started: 2026-03-04T13:00:00.000Z
updated: 2026-03-04T13:00:00.000Z
---

## Criteria

- [x] ISC-1: Recover from corrupt work.json using backup state
`;
}

async function runPrdSyncHook(args: {
  runtimeRoot: string;
  payload: Record<string, unknown>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/PRDSync.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: args.runtimeRoot,
      OPENCODE_CONFIG_ROOT: args.runtimeRoot,
      PAI_DIR: args.runtimeRoot,
      CMUX_SOCKET_PATH: "",
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

describe("work.json corruption recovery", () => {
  test("invalid work.json falls back to work.json.bak and preserves prior data", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "pai-prdsync-corruption-recover-"));
    const stateDir = path.join(runtimeRoot, "MEMORY", "STATE");
    const workPath = path.join(stateDir, "work.json");
    const backupPath = path.join(stateDir, "work.json.bak");
    const sessionUUID = "session-prdsync-recovered";
    const newSlug = "recovered-entry";

    const backupState = {
      v: "0.1",
      updatedAt: "2026-03-04T00:00:00.000Z",
      sessions: {
        "existing-entry": {
          sessionUUID: "session-existing",
          targetKey: "existing-entry",
          source: "placeholder",
          criteria: [],
          updatedAt: "2026-03-04T00:00:00.000Z",
        },
      },
    };

    const prdPath = path.join(runtimeRoot, "MEMORY", "WORK", "2026-03", sessionUUID, "PRD-20260304-recovered.md");

    try {
      await mkdir(path.dirname(prdPath), { recursive: true });
      await mkdir(stateDir, { recursive: true });

      await writeFile(prdPath, makePrd(newSlug), "utf8");
      await writeFile(workPath, "{ invalid-json", "utf8");
      await writeFile(backupPath, `${JSON.stringify(backupState, null, 2)}\n`, "utf8");

      const run = await runPrdSyncHook({
        runtimeRoot,
        payload: {
          session_id: sessionUUID,
          tool_input: {
            file_path: prdPath,
          },
        },
      });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe('{"continue": true}\n');

      const stateRaw = await readFile(workPath, "utf8");
      const state = JSON.parse(stateRaw) as {
        sessions?: Record<string, { sessionUUID?: string; phase?: string }>;
      };

      expect(state.sessions?.["existing-entry"]?.sessionUUID).toBe("session-existing");
      expect(state.sessions?.[newSlug]?.sessionUUID).toBe(sessionUUID);
      expect(state.sessions?.[newSlug]?.phase).toBe("VERIFY");
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
