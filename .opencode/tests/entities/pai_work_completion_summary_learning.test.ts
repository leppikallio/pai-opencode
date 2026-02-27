import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { captureWorkCompletionSummary } from "../../plugins/handlers/learning-capture";

async function withEnv(overrides: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
    }
  };

  await walk(root);
  return out;
}

async function setupSession(root: string, sessionId: string, criteria: Array<{ id: string; text: string; status: string }>): Promise<string> {
  const workDir = path.join(root, "MEMORY", "WORK", "2099-01", sessionId);
  const stateDir = path.join(root, "MEMORY", "STATE");
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });

  await fs.writeFile(
    path.join(stateDir, "current-work.json"),
    `${JSON.stringify(
      {
        v: "0.2",
        updated_at: new Date().toISOString(),
        sessions: {
          [sessionId]: {
            work_dir: workDir,
            started_at: new Date().toISOString(),
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(workDir, "META.yaml"),
    `status: ACTIVE\nstarted_at: ${new Date().toISOString()}\ntitle: "Summary Learning Session"\nopencode_session_id: ${sessionId}\nwork_id: test\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(workDir, "ISC.json"),
    `${JSON.stringify(
      {
        v: "0.1",
        ideal: "",
        criteria,
        antiCriteria: [],
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await fs.writeFile(path.join(workDir, "THREAD.md"), "# THREAD\n", "utf8");
  return workDir;
}

describe("work completion summary learning", () => {
  test("writes a summary when verified ISC criteria exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-summary-learning-"));
    const sessionId = "ses_summary_verified";

    try {
      await setupSession(root, sessionId, [
        { id: "isc-1", text: "Verified output", status: "VERIFIED" },
        { id: "isc-2", text: "Pending output", status: "PENDING" },
      ]);

      await withEnv(
        {
          OPENCODE_ROOT: root,
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ENABLE_WORK_COMPLETION_SUMMARY: "1",
        },
        async () => {
          const result = await captureWorkCompletionSummary(sessionId);
          expect(result.success).toBe(true);

          const files = await listMarkdownFilesRecursive(path.join(root, "MEMORY", "LEARNING"));
          expect(files).toHaveLength(1);

          const content = await fs.readFile(files[0], "utf8");
          expect(content).toContain("# Work Completion Summary");
          expect(content).toContain(`**Session:** ${sessionId}`);
          expect(content).toContain("Verified ISC criteria: 1");
        },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("skips summary when work is not significant", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-summary-learning-insignificant-"));
    const sessionId = "ses_summary_insignificant";

    try {
      await setupSession(root, sessionId, [
        { id: "isc-1", text: "Pending output", status: "PENDING" },
      ]);

      await withEnv(
        {
          OPENCODE_ROOT: root,
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ENABLE_WORK_COMPLETION_SUMMARY: "1",
        },
        async () => {
          const result = await captureWorkCompletionSummary(sessionId);
          expect(result.success).toBe(true);

          const files = await listMarkdownFilesRecursive(path.join(root, "MEMORY", "LEARNING"));
          expect(files).toHaveLength(0);
        },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
