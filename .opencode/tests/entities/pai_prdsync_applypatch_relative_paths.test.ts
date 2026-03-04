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

function makePrd(args: { slug: string; phase: string }): string {
  return `---
task: Relative ApplyPatch
slug: ${args.slug}
effort: standard
phase: ${args.phase}
progress: 0/1
mode: interactive
started: 2026-03-04T08:00:00.000Z
updated: 2026-03-04T08:00:00.000Z
---

## Criteria

- [ ] ISC-1: Relative patch path resolves through payload cwd first
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

describe("PRDSync apply_patch relative paths", () => {
  test("resolves relative patch paths via payload.cwd", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "pai-prdsync-relative-"));
    const workspaceRoot = path.join(runtimeRoot, "workspace");
    const sessionUUID = "session-prdsync-relative";
    const relativePrdPath = `../MEMORY/WORK/2026-03/${sessionUUID}/PRD-20260304-relative.md`;
    const absolutePrdPath = path.join(runtimeRoot, "MEMORY", "WORK", "2026-03", sessionUUID, "PRD-20260304-relative.md");

    try {
      await mkdir(path.dirname(absolutePrdPath), { recursive: true });
      await mkdir(workspaceRoot, { recursive: true });
      await writeFile(absolutePrdPath, makePrd({ slug: "relative-path", phase: "plan" }), "utf8");

      const run = await runPrdSyncHook({
        runtimeRoot,
        payload: {
          session_id: sessionUUID,
          cwd: workspaceRoot,
          tool_input: {
            patch_text: `*** Begin Patch\n*** Update File: ${relativePrdPath}\n*** End Patch\n`,
          },
        },
      });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe('{"continue": true}\n');

      const workStateRaw = await readFile(path.join(runtimeRoot, "MEMORY", "STATE", "work.json"), "utf8");
      const workState = JSON.parse(workStateRaw) as {
        sessions?: Record<string, { sessionUUID?: string; phase?: string; prdPath?: string }>;
      };

      const entry = workState.sessions?.["relative-path"];
      expect(entry?.sessionUUID).toBe(sessionUUID);
      expect(entry?.phase).toBe("PLAN");
      expect(entry?.prdPath).toBe(path.resolve(absolutePrdPath));
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
