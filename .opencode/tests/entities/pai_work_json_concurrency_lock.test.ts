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
task: Concurrency test ${slug}
slug: ${slug}
effort: standard
phase: build
progress: 0/1
mode: interactive
started: 2026-03-04T12:00:00.000Z
updated: 2026-03-04T12:00:00.000Z
---

## Criteria

- [ ] ISC-1: Lock keeps work.json writes non-lossy under contention
`;
}

async function runPrdSyncHook(args: {
  runtimeRoot: string;
  payload: Record<string, unknown>;
  envOverrides?: Record<string, string | undefined>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/PRDSync.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: args.runtimeRoot,
      OPENCODE_CONFIG_ROOT: args.runtimeRoot,
      PAI_DIR: args.runtimeRoot,
      CMUX_SOCKET_PATH: "",
      ...args.envOverrides,
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

describe("work.json concurrency lock", () => {
  test("parallel PRDSync writers preserve all session entries", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "pai-prdsync-lock-"));

    try {
      const totalSessions = 8;
      const runs: Array<Promise<{ exitCode: number; stdout: string; stderr: string }>> = [];
      const slugs: string[] = [];

      for (let idx = 0; idx < totalSessions; idx += 1) {
        const sessionUUID = `session-prdsync-lock-${idx}`;
        const slug = `concurrency-${idx}`;
        slugs.push(slug);

        const prdPath = path.join(
          runtimeRoot,
          "MEMORY",
          "WORK",
          "2026-03",
          sessionUUID,
          `PRD-20260304-${slug}.md`,
        );
        await mkdir(path.dirname(prdPath), { recursive: true });
        await writeFile(prdPath, makePrd(slug), "utf8");

        runs.push(
          runPrdSyncHook({
            runtimeRoot,
            payload: {
              session_id: sessionUUID,
              tool_input: {
                filePath: prdPath,
              },
            },
          }),
        );
      }

      const outcomes = await Promise.all(runs);
      for (const outcome of outcomes) {
        expect(outcome.exitCode).toBe(0);
        expect(outcome.stdout).toBe('{"continue": true}\n');
      }

      const workStateRaw = await readFile(path.join(runtimeRoot, "MEMORY", "STATE", "work.json"), "utf8");
      const workState = JSON.parse(workStateRaw) as {
        sessions?: Record<string, { sessionUUID?: string; slug?: string }>;
      };

      const sessionEntries = workState.sessions ?? {};
      for (const slug of slugs) {
        expect(sessionEntries[slug]?.slug).toBe(slug);
      }
      expect(Object.keys(sessionEntries)).toHaveLength(totalSessions);
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("emits apply-skipped marker when lock acquisition times out", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "pai-prdsync-lock-timeout-"));
    const sessionUUID = "session-prdsync-lock-timeout";
    const prdPath = path.join(runtimeRoot, "MEMORY", "WORK", "2026-03", sessionUUID, "PRD-20260304-timeout.md");
    const lockDir = path.join(runtimeRoot, "MEMORY", "STATE", "work.json.lock");

    try {
      await mkdir(path.dirname(prdPath), { recursive: true });
      await mkdir(lockDir, { recursive: true });
      await writeFile(prdPath, makePrd("lock-timeout"), "utf8");
      await writeFile(
        path.join(lockDir, "lock.json"),
        `${JSON.stringify({ created_at: new Date().toISOString(), token: "held-by-test" })}\n`,
        "utf8",
      );

      const run = await runPrdSyncHook({
        runtimeRoot,
        payload: {
          session_id: sessionUUID,
          tool_input: {
            filePath: prdPath,
          },
        },
        envOverrides: {
          PAI_PRDSYNC_WORK_LOCK_MAX_WAIT_MS: "20",
        },
      });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe('{"continue": true}\n');
      expect(run.stderr).toContain("PAI_PRDSYNC_WORK_JSON_LOCK_TIMEOUT");
      expect(run.stderr).toContain("PAI_PRDSYNC_WORK_JSON_APPLY_SKIPPED:lock-timeout");
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
