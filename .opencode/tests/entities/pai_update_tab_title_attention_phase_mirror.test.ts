import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { setTabState } from "../../hooks/lib/tab-state";
import {
  __testOnlyResetCmuxCliState,
  __testOnlySetCmuxCliExec,
} from "../../plugins/pai-cc-hooks/shared/cmux-cli";
import { upsertSessionMapping } from "../../plugins/pai-cc-hooks/shared/cmux-session-map";
import { createQueuedCmuxCliExecStub } from "../helpers/cmux-cli-exec-stub";

function tabStatePath(runtimeRoot: string, sessionId: string): string {
  return path.join(runtimeRoot, "MEMORY", "STATE", `tab-state-${sessionId}.json`);
}

async function makeRuntimeRoot(prefix: string): Promise<string> {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(runtimeRoot, "hooks"), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, "skills"), { recursive: true });
  return runtimeRoot;
}

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

describe("UpdateTabTitle attention phase mirror", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
  });

  afterEach(() => {
    __testOnlyResetCmuxCliState();
  });

  test("normal prompt keeps title updates and emits CLI oc_phase mirror with progress labels", async () => {
    const runtimeRoot = await makeRuntimeRoot("pai-update-title-phase-");
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-update-title-home-"));
    const previousHome = process.env.HOME;
    const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const stub = createQueuedCmuxCliExecStub(
      Array.from({ length: 6 }, () => ({ exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false })),
      { onEmpty: "throw" },
    );

    process.env.HOME = homeDir;
    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.CMUX_WORKSPACE_ID = "workspace-env";
    process.env.CMUX_SURFACE_ID = "surface-env";
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      await upsertSessionMapping({
        sessionId: "S-phase",
        workspaceId: "workspace-map",
        surfaceId: "surface-map",
      });

      await setTabState({
        title: "🧠 fix auth refresh token rotation",
        state: "thinking",
        sessionId: "S-phase",
        phaseToken: "THINK",
      });

      await setTabState({
        title: "⚙️ fix auth refresh token rotation",
        state: "working",
        sessionId: "S-phase",
        phaseToken: "WORK",
      });

      const snapshotRaw = await fs.readFile(tabStatePath(runtimeRoot, "S-phase"), "utf8");
      const snapshot = JSON.parse(snapshotRaw) as { title?: string; state?: string };
      expect(snapshot.state).toBe("working");
      expect(snapshot.title?.startsWith("⚙️")).toBe(true);

      const capturedArgv = stub.calls.map((call) => call.args);
      expect(capturedArgv).toHaveLength(6);

      const renameArgv = capturedArgv.filter((argv) => argv[0] === "rename-tab");
      expect(renameArgv).toEqual([
        [
          "rename-tab",
          "--workspace",
          "workspace-map",
          "--surface",
          "surface-map",
          "--",
          "🧠 fix auth refresh token rotation",
        ],
        [
          "rename-tab",
          "--workspace",
          "workspace-map",
          "--surface",
          "surface-map",
          "--",
          "⚙️ fix auth refresh token rotation",
        ],
      ]);

      const phaseStatusArgv = capturedArgv.filter((argv) => argv[0] === "set-status");
      expect(phaseStatusArgv).toEqual([
        ["set-status", "oc_phase", "THINK", "--workspace", "workspace-map"],
        ["set-status", "oc_phase", "WORK", "--workspace", "workspace-map"],
      ]);

      const progressArgv = capturedArgv.filter((argv) => argv[0] === "set-progress");
      expect(progressArgv).toEqual([
        ["set-progress", "0.2", "--label", "THINK", "--workspace", "workspace-map"],
        ["set-progress", "0.6", "--label", "WORK", "--workspace", "workspace-map"],
      ]);
    } finally {
      await fs.rm(runtimeRoot, { recursive: true, force: true });
      await fs.rm(homeDir, { recursive: true, force: true });
      restoreEnv("HOME", previousHome);
      restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });
});
