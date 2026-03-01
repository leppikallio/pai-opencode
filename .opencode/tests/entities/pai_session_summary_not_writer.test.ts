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

async function runSessionSummaryHook(args: {
  paiDir: string;
  payload: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/SessionSummary.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: args.paiDir,
      ...args.env,
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

async function listMarkdownFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];

  const walk = async (dir: string) => {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  };

  await walk(root);
  return out;
}

describe("SessionSummary hook", () => {
  test("completes work state but does not write work completion learning", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-session-summary-not-writer-"));
    const sessionId = "session-summary-no-writer";
    const workDir = path.join(paiDir, "MEMORY", "WORK", "2099-01", sessionId);
    const statePath = path.join(paiDir, "MEMORY", "STATE", "current-work.json");

    try {
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      await fs.writeFile(
        statePath,
        `${JSON.stringify({
          v: "0.2",
          updated_at: new Date().toISOString(),
          sessions: {
            [sessionId]: {
              work_dir: workDir,
              started_at: new Date().toISOString(),
            },
          },
        }, null, 2)}\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "META.yaml"),
        `status: ACTIVE\nstarted_at: ${new Date().toISOString()}\ntitle: "Session Summary Non Writer"\nopencode_session_id: ${sessionId}\nwork_id: test\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "ISC.json"),
        `${JSON.stringify({
          v: "0.1",
          ideal: "",
          criteria: [
            {
              id: "isc-1",
              text: "Verified criterion",
              status: "VERIFIED",
            },
          ],
          antiCriteria: [],
          updatedAt: new Date().toISOString(),
        }, null, 2)}\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "LINEAGE.json"),
        `${JSON.stringify({
          v: "0.1",
          updated_at: new Date().toISOString(),
          tools_used: {
            apply_patch: 1,
          },
          files_changed: ["src/example.ts"],
          agents_spawned: [],
        }, null, 2)}\n`,
        "utf8",
      );

      const result = await runSessionSummaryHook({
        paiDir,
        payload: { session_id: sessionId },
        env: {
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ENABLE_WORK_COMPLETION_SUMMARY: "1",
          PAI_ENABLE_FINE_GRAIN_LEARNINGS: "0",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");

      const stateAfter = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        sessions?: Record<string, unknown>;
      };
      expect(stateAfter.sessions?.[sessionId]).toBeUndefined();

      const learningFiles = await listMarkdownFilesRecursive(path.join(paiDir, "MEMORY", "LEARNING"));
      expect(learningFiles).toHaveLength(0);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
