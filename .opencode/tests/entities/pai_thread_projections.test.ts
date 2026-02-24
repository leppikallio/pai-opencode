import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getConversationTextFromThread } from "../../plugins/pai-cc-hooks/shared/thread-projections";

describe("thread projections", () => {
  test("reads THREAD.md via current-work.json mapping", async () => {
    const root = path.join(os.tmpdir(), `pai-${Date.now()}`);
    const stateDir = path.join(root, "MEMORY", "STATE");
    const workDir = path.join(root, "MEMORY", "WORK", "2099-01", "ses_abc");

    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, "current-work.json"),
      JSON.stringify(
        {
          v: "0.2",
          updated_at: new Date().toISOString(),
          sessions: {
            ses_abc: {
              work_dir: workDir,
            },
          },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(workDir, "THREAD.md"), "# Title\n\nhello\n", "utf-8");

    const previousPaiDir = process.env.PAI_DIR;
    process.env.PAI_DIR = root;
    try {
      const text = await getConversationTextFromThread({ sessionId: "ses_abc", maxChars: 1000 });
      expect(text).toContain("hello");
    } finally {
      if (previousPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = previousPaiDir;
      }
    }
  });
});
