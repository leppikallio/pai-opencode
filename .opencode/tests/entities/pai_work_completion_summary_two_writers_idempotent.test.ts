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

describe("work completion summary idempotency", () => {
  test("two concurrent writers produce exactly one summary file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-summary-two-writers-"));
    const sessionId = "ses_summary_two_writers";
    const workDir = path.join(root, "MEMORY", "WORK", "2099-01", sessionId);

    try {
      await fs.mkdir(path.join(root, "MEMORY", "STATE"), { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      await fs.writeFile(
        path.join(root, "MEMORY", "STATE", "current-work.json"),
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
        `status: ACTIVE\nstarted_at: ${new Date().toISOString()}\ntitle: "Two Writers"\nopencode_session_id: ${sessionId}\nwork_id: test\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "ISC.json"),
        `${JSON.stringify(
          {
            v: "0.1",
            ideal: "",
            criteria: [],
            antiCriteria: [],
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await fs.writeFile(
        path.join(workDir, "LINEAGE.json"),
        `${JSON.stringify(
          {
            v: "0.1",
            updated_at: new Date().toISOString(),
            tools_used: {
              apply_patch: 1,
            },
            files_changed: ["src/example.ts"],
            agents_spawned: [],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await withEnv(
        {
          OPENCODE_ROOT: root,
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ENABLE_WORK_COMPLETION_SUMMARY: "1",
        },
        async () => {
          await Promise.all([
            captureWorkCompletionSummary(sessionId),
            captureWorkCompletionSummary(sessionId),
          ]);

          const files = await listMarkdownFilesRecursive(path.join(root, "MEMORY", "LEARNING"));
          expect(files).toHaveLength(1);

          const content = await fs.readFile(files[0], "utf8");
          expect(content).toContain("# Work Completion Learning");
          expect(content).toContain("apply_patch=1");
        },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
