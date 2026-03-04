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

function makePrd(): string {
  return `---
task: Dual corruption failure
slug: dual-corruption
effort: standard
phase: learn
progress: 0/1
mode: interactive
started: 2026-03-04T14:00:00.000Z
updated: 2026-03-04T14:00:00.000Z
---

## Criteria

- [ ] ISC-1: Skip writes when both work.json and backup are corrupted
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

describe("work.json dual corruption handling", () => {
  test("does not overwrite corrupt work state when both work and backup fail", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "pai-prdsync-corruption-dual-"));
    const stateDir = path.join(runtimeRoot, "MEMORY", "STATE");
    const workPath = path.join(stateDir, "work.json");
    const backupPath = path.join(stateDir, "work.json.bak");
    const sessionUUID = "session-prdsync-corrupt-dual";
    const prdPath = path.join(runtimeRoot, "MEMORY", "WORK", "2026-03", sessionUUID, "PRD-20260304-dual.md");

    try {
      await mkdir(path.dirname(prdPath), { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await writeFile(prdPath, makePrd(), "utf8");

      await writeFile(workPath, "{ not-json-work", "utf8");
      await writeFile(backupPath, "{ not-json-backup", "utf8");

      const before = await readFile(workPath, "utf8");
      const run = await runPrdSyncHook({
        runtimeRoot,
        payload: {
          session_id: sessionUUID,
          tool_input: {
            filePath: prdPath,
          },
        },
      });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe('{"continue": true}\n');
      expect(run.stderr).toContain("PAI_PRDSYNC_WORK_JSON_CORRUPT_DUAL_FAILURE");

      const after = await readFile(workPath, "utf8");
      expect(after).toBe(before);
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
