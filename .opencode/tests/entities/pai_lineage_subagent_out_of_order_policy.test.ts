import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createHistoryCapture } from "../../plugins/handlers/history-capture";

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

describe("lineage subagent out-of-order policy", () => {
  test("records only post-link child tool activity under the parent lineage", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-lineage-out-of-order-"));
    const parentSessionId = "ses_lineage_parent_oop";
    const childSessionId = "ses_lineage_child_oop";
    const workDir = path.join(root, "MEMORY", "WORK", "2099-01", parentSessionId);
    const workspaceDir = path.join(root, "workspace");

    try {
      await fs.mkdir(workDir, { recursive: true });
      await fs.mkdir(path.join(root, "MEMORY", "STATE"), { recursive: true });
      await fs.mkdir(path.join(workspaceDir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(root, "MEMORY", "STATE", "current-work.json"),
        `${JSON.stringify(
          {
            v: "0.2",
            updated_at: new Date().toISOString(),
            sessions: {
              [parentSessionId]: { work_dir: workDir },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await fs.writeFile(
        path.join(workDir, "META.yaml"),
        `status: ACTIVE\nstarted_at: ${new Date().toISOString()}\ntitle: "lineage parent"\nopencode_session_id: ${parentSessionId}\n`,
        "utf8",
      );

      await withEnv(
        {
          OPENCODE_ROOT: root,
          OPENCODE_DIRECTORY: workspaceDir,
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ENABLE_LINEAGE_TRACKING: "1",
        },
        async () => {
          const capture = createHistoryCapture({ directory: root });

          await capture.handleToolBefore(
            {
              tool: "Write",
              sessionID: childSessionId,
              callID: "call-before-link",
            },
            {
              filePath: path.join(workspaceDir, "src", "before-link.ts"),
            },
          );

          await capture.handleToolAfter(
            {
              tool: "Write",
              sessionID: childSessionId,
              callID: "call-before-link",
            },
            {
              output: "ok",
            },
          );

          await capture.handleEvent({
            type: "session.created",
            properties: {
              info: {
                id: childSessionId,
                parentID: parentSessionId,
                title: "child agent",
              },
            },
          });

          await capture.handleToolBefore(
            {
              tool: "Write",
              sessionID: childSessionId,
              callID: "call-after-link",
            },
            {
              filePath: path.join(workspaceDir, "src", "after-link.ts"),
            },
          );

          await capture.handleToolAfter(
            {
              tool: "Write",
              sessionID: childSessionId,
              callID: "call-after-link",
            },
            {
              output: "ok",
            },
          );
        },
      );

      const lineageRaw = await fs.readFile(path.join(workDir, "LINEAGE.json"), "utf8");
      const lineage = JSON.parse(lineageRaw) as {
        tools_used: Record<string, number>;
        files_changed: string[];
      };

      expect(lineage.tools_used.write).toBe(1);
      expect(lineage.files_changed).toContain("src/after-link.ts");
      expect(lineage.files_changed).not.toContain("src/before-link.ts");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
