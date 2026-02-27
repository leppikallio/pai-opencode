import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { recordToolUse } from "../../plugins/handlers/lineage-tracker";

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

async function setupSessionRoot(): Promise<{ root: string; sessionId: string; workDir: string; workspaceDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-lineage-updates-"));
  const sessionId = "ses_lineage_updates";
  const workDir = path.join(root, "MEMORY", "WORK", "2099-01", sessionId);
  const workspaceDir = path.join(root, "workspace");
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(path.join(root, "MEMORY", "STATE"), { recursive: true });
  await fs.writeFile(
    path.join(root, "MEMORY", "STATE", "current-work.json"),
    `${JSON.stringify(
      {
        v: "0.2",
        updated_at: new Date().toISOString(),
        sessions: {
          [sessionId]: { work_dir: workDir },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return { root, sessionId, workDir, workspaceDir };
}

describe("lineage tracker updates", () => {
  test("captures apply_patch and write/edit files while preserving privacy", async () => {
    const { root, sessionId, workDir, workspaceDir } = await setupSessionRoot();
    const absoluteWritePath = path.join(workspaceDir, "src", "feature.ts");

    try {
      await withEnv(
        {
          OPENCODE_ROOT: root,
          OPENCODE_DIRECTORY: workspaceDir,
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ENABLE_LINEAGE_TRACKING: "1",
        },
        async () => {
          await recordToolUse(sessionId, "Apply_Patch", {
            patchText: [
              "*** Update File: src/app.ts",
              "@@",
              "-old",
              "+new",
            ].join("\n"),
          });

          await recordToolUse(sessionId, "Write", { filePath: absoluteWritePath });
          await recordToolUse(sessionId, "EDIT", { filePath: path.join(workspaceDir, "src", "editor.ts") });
        },
      );

      const lineagePath = path.join(workDir, "LINEAGE.json");
      const raw = await fs.readFile(lineagePath, "utf8");
      const parsed = JSON.parse(raw) as {
        tools_used: Record<string, number>;
        files_changed: string[];
      };

      expect(parsed.tools_used.apply_patch).toBe(1);
      expect(parsed.tools_used.write).toBe(1);
      expect(parsed.tools_used.edit).toBe(1);

      expect(parsed.files_changed).toContain("src/app.ts");
      expect(parsed.files_changed).toContain("src/feature.ts");
      expect(parsed.files_changed).toContain("src/editor.ts");

      expect(raw.includes("patchText")).toBe(false);
      expect(raw.includes("*** Update File:")).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
