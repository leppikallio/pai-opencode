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

function buildPrdContent(): string {
  return `---
task: Ship PRDSync
slug: prdsync-hook-write
effort: extended
phase: observe
progress: 1/2
mode: interactive
started: 2026-03-04T08:00:00.000Z
updated: 2026-03-04T08:01:00.000Z
---

## Context

PRDSync write test.

## Criteria

- [ ] ISC-1: Persist work state from PRD update
- [x] ISC-A-1: Do not lose completed validation markers

## Decisions

None.

## Verification

Pending.
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

describe("PRDSync hook", () => {
  test("writes work.json from Edit payload path and updates phase tab", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "pai-prdsync-write-"));
    const sessionUUID = "session-prdsync-write";
    const prdDir = path.join(runtimeRoot, "MEMORY", "WORK", "2026-03", sessionUUID);
    const prdPath = path.join(prdDir, "PRD-20260304-prdsync-hook-write.md");

    try {
      await mkdir(prdDir, { recursive: true });
      await writeFile(prdPath, buildPrdContent(), "utf8");

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

      const workJsonPath = path.join(runtimeRoot, "MEMORY", "STATE", "work.json");
      const workJsonBackupPath = path.join(runtimeRoot, "MEMORY", "STATE", "work.json.bak");
      const raw = await readFile(workJsonPath, "utf8");
      const state = JSON.parse(raw) as {
        v?: string;
        sessions?: Record<
          string,
          {
            sessionUUID?: string;
            task?: string;
            phase?: string;
            criteria?: Array<{ id?: string; description?: string; status?: string; type?: string }>;
          }
        >;
      };

      expect(state.v).toBe("0.1");
      const entry = state.sessions?.["prdsync-hook-write"];
      expect(entry?.sessionUUID).toBe(sessionUUID);
      expect(entry?.task).toBe("Ship PRDSync");
      expect(entry?.phase).toBe("OBSERVE");
      expect(entry?.criteria).toEqual([
        {
          id: "ISC-1",
          description: "Persist work state from PRD update",
          type: "criterion",
          status: "pending",
        },
        {
          id: "ISC-A-1",
          description: "Do not lose completed validation markers",
          type: "anti",
          status: "complete",
        },
      ]);

      const backupRaw = await readFile(workJsonBackupPath, "utf8");
      expect(backupRaw).toContain("prdsync-hook-write");

      const tabStatePath = path.join(runtimeRoot, "MEMORY", "STATE", `tab-state-${sessionUUID}.json`);
      const tabRaw = await readFile(tabStatePath, "utf8");
      expect(tabRaw).toContain('"phase": "OBSERVE"');
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
