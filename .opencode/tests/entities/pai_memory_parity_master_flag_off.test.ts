import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createHistoryCapture } from "../../plugins/handlers/history-capture";
import { captureRelationshipMemory } from "../../plugins/handlers/relationship-memory";

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

async function withProcessEnv(overrides: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function runHook(args: {
  script: string;
  paiDir: string;
  payload: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", args.script],
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

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getWorkDir(paiDir: string, sessionId: string): Promise<string> {
  const state = JSON.parse(await fs.readFile(path.join(paiDir, "MEMORY", "STATE", "current-work.json"), "utf8")) as {
    sessions?: Record<string, { work_dir?: string }>;
  };
  const workDir = state.sessions?.[sessionId]?.work_dir;
  if (!workDir) {
    throw new Error(`work_dir missing for session ${sessionId}`);
  }
  return workDir;
}

async function listPrdFiles(workDir: string): Promise<string[]> {
  const entries = await fs.readdir(workDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^PRD-\d{8}-[a-z0-9-]+\.md$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
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

function dailyRelationshipPath(root: string): string {
  const now = new Date();
  const yearMonth = now.toISOString().slice(0, 7);
  const date = now.toISOString().slice(0, 10);
  return path.join(root, "MEMORY", "RELATIONSHIP", yearMonth, `${date}.md`);
}

describe("memory parity master kill-switch", () => {
  test("PAI_ENABLE_MEMORY_PARITY=0 blocks parity artifacts across hooks and handlers", async () => {
    const paiDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-memory-parity-off-"));
    const workspaceDir = path.join(paiDir, "workspace");
    const sessionId = "session-memory-parity-off";

    try {
      await fs.mkdir(workspaceDir, { recursive: true });

      const autoWorkCreation = await runHook({
        script: ".opencode/hooks/AutoWorkCreation.hook.ts",
        paiDir,
        payload: {
          session_id: sessionId,
          prompt: "Implement deterministic memory parity coverage for hook artifacts",
        },
        env: {
          PAI_ENABLE_MEMORY_PARITY: "0",
          PAI_ENABLE_AUTO_PRD: "1",
          PAI_ENABLE_AUTO_PRD_PROMPT_CLASSIFICATION: "1",
        },
      });

      expect(autoWorkCreation.exitCode).toBe(0);
      expect(autoWorkCreation.stderr).toBe("");

      const workDir = await getWorkDir(paiDir, sessionId);

      expect(await listPrdFiles(workDir)).toHaveLength(0);
      expect(await exists(path.join(workDir, "PROMPT_CLASSIFICATION.json"))).toBe(false);

      await fs.writeFile(
        path.join(workDir, "ISC.json"),
        `${JSON.stringify({
          v: "0.1",
          ideal: "",
          criteria: [{ id: "isc-1", text: "Verified criterion", status: "VERIFIED" }],
          antiCriteria: [],
          updatedAt: new Date().toISOString(),
        }, null, 2)}\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "THREAD.md"),
        [
          "# THREAD",
          "",
          "**User:** I prefer concise updates and clear next steps.",
          "**Assistant:** 📋 SUMMARY: Should be blocked by master parity switch.",
        ].join("\n"),
        "utf8",
      );

      await withProcessEnv(
        {
          OPENCODE_ROOT: paiDir,
          OPENCODE_DIRECTORY: workspaceDir,
          PAI_ENABLE_MEMORY_PARITY: "0",
          PAI_ENABLE_LINEAGE_TRACKING: "1",
          PAI_ENABLE_RELATIONSHIP_MEMORY: "1",
        },
        async () => {
          const capture = createHistoryCapture({ directory: paiDir });
          const callId = "call-memory-parity-off";
          await capture.handleToolBefore(
            { tool: "write", sessionID: sessionId, callID: callId },
            { filePath: path.join(workspaceDir, "src", "feature.ts") },
          );
          await capture.handleToolAfter(
            { tool: "write", sessionID: sessionId, callID: callId },
            { title: "Write", output: "ok" },
          );

          await captureRelationshipMemory(sessionId);
        },
      );

      expect(await exists(path.join(workDir, "LINEAGE.json"))).toBe(false);
      expect(await exists(dailyRelationshipPath(paiDir))).toBe(false);

      const workCompletionLearning = await runHook({
        script: ".opencode/hooks/WorkCompletionLearning.hook.ts",
        paiDir,
        payload: { session_id: sessionId },
        env: {
          PAI_ENABLE_MEMORY_PARITY: "0",
          PAI_ENABLE_WORK_COMPLETION_SUMMARY: "1",
          PAI_ENABLE_FINE_GRAIN_LEARNINGS: "0",
        },
      });

      expect(workCompletionLearning.exitCode).toBe(0);
      expect(workCompletionLearning.stderr).toBe("");

      expect(await listMarkdownFilesRecursive(path.join(paiDir, "MEMORY", "LEARNING"))).toHaveLength(0);
    } finally {
      await fs.rm(paiDir, { recursive: true, force: true });
    }
  });
});
