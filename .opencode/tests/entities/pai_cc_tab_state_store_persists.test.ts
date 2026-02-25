import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readTabState, setTabState } from "../../hooks/lib/tab-state";
import { readTabSnapshot } from "../../hooks/lib/tab-state-store";

function createTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-tab-state-"));
}

describe("tab-state store persistence", () => {
  test("persists tab snapshots to MEMORY/STATE and reads them back", async () => {
    const paiDir = createTempRoot();
    const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
    const previousCmuxSocket = process.env.CMUX_SOCKET_PATH;

    process.env.OPENCODE_ROOT = paiDir;
    process.env.CMUX_SOCKET_PATH = "";

    try {
      await setTabState({
        sessionId: "S1",
        title: "X",
        state: "working",
      });

      const snapshotPath = path.join(paiDir, "MEMORY", "STATE", "tab-state-S1.json");
      expect(fs.existsSync(snapshotPath)).toBe(true);

      const onDisk = JSON.parse(fs.readFileSync(snapshotPath, "utf-8")) as Record<string, unknown>;
      expect(onDisk.title).toBe("X");
      expect(onDisk.state).toBe("working");

      expect(readTabSnapshot("S1")).toEqual({
        title: "X",
        state: "working",
      });

      expect(readTabState("S1")).toEqual({
        title: "X",
        state: "working",
      });

      await setTabState({
        sessionId: "../x",
        title: "Should not persist",
        state: "working",
      });

      const invalidSnapshotPath = path.join(paiDir, "MEMORY", "STATE", "tab-state-..", "x.json");
      expect(fs.existsSync(invalidSnapshotPath)).toBe(false);
      expect(readTabSnapshot("../x")).toBeNull();
    } finally {
      if (previousOpenCodeRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousOpenCodeRoot;
      }

      if (previousCmuxSocket === undefined) {
        delete process.env.CMUX_SOCKET_PATH;
      } else {
        process.env.CMUX_SOCKET_PATH = previousCmuxSocket;
      }
    }
  });
});
