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
task: Windows apply_patch parsing
slug: ${slug}
effort: extended
phase: execute
progress: 0/1
mode: interactive
started: 2026-03-04T10:00:00.000Z
updated: 2026-03-04T10:00:00.000Z
---

## Criteria

- [ ] ISC-1: Windows path in apply_patch is parsed correctly
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

describe("PRDSync apply_patch windows path support", () => {
  test("parses quoted windows separators and move destination", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "pai-prdsync-win-"));
    const sessionUUID = "session-prdsync-win";
    const sessionDir = path.join(runtimeRoot, "MEMORY", "WORK", "2026-03", sessionUUID);
    const movedPrdPath = path.join(sessionDir, "PRD-20260304-new.md");

    try {
      await mkdir(sessionDir, { recursive: true });
      await writeFile(movedPrdPath, makePrd("windows-move-destination"), "utf8");

      const run = await runPrdSyncHook({
        runtimeRoot,
        payload: {
          session_id: sessionUUID,
          cwd: runtimeRoot,
          tool_input: {
            patchText: [
              "*** Begin Patch",
              '*** Update File: "MEMORY\\\\WORK\\\\2026-03\\\\session-prdsync-win\\\\PRD-20260304-old.md"',
              '*** Move to: "MEMORY\\\\WORK\\\\2026-03\\\\session-prdsync-win\\\\PRD-20260304-new.md"',
              "*** End Patch",
              "",
            ].join("\n"),
          },
        },
      });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe('{"continue": true}\n');

      const workStateRaw = await readFile(path.join(runtimeRoot, "MEMORY", "STATE", "work.json"), "utf8");
      const workState = JSON.parse(workStateRaw) as {
        sessions?: Record<string, { sessionUUID?: string; prdPath?: string; phase?: string }>;
      };

      const entry = workState.sessions?.["windows-move-destination"];
      expect(entry?.sessionUUID).toBe(sessionUUID);
      expect(entry?.phase).toBe("EXECUTE");
      expect(entry?.prdPath).toBe(path.resolve(movedPrdPath));
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
