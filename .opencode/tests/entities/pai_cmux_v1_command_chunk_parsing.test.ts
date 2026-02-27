import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { mirrorCurrentCmuxPhase } from "../../hooks/lib/cmux-v2";
import {
  __testOnlyResetCmuxCliState,
  __testOnlySetCmuxCliExec,
} from "../../plugins/pai-cc-hooks/shared/cmux-cli";
import { upsertSessionMapping } from "../../plugins/pai-cc-hooks/shared/cmux-session-map";
import { createQueuedCmuxCliExecStub } from "../helpers/cmux-cli-exec-stub";

function cleanupDir(directoryPath: string): void {
  try {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  } catch {}
}

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

describe("cmux phase mirror", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
  });

  afterEach(() => {
    __testOnlyResetCmuxCliState();
  });

  test("mirrors phase via CLI set-status and set-progress using mapped workspace", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-phase-mirror-cli-"));
    const previousHome = process.env.HOME;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
      ],
      { onEmpty: "throw" },
    );

    process.env.HOME = homeDir;
    process.env.CMUX_WORKSPACE_ID = "workspace-env";
    process.env.CMUX_SURFACE_ID = "surface-env";
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      await upsertSessionMapping({
        sessionId: "ses_phase",
        workspaceId: "workspace-map",
        surfaceId: "surface-map",
      });

      await mirrorCurrentCmuxPhase({ phaseToken: "  think  ", sessionId: "ses_phase" });

      expect(stub.calls).toHaveLength(2);
      expect(stub.calls[0]?.args).toEqual([
        "set-status",
        "oc_phase",
        "THINK",
        "--workspace",
        "workspace-map",
      ]);
      expect(stub.calls[1]?.args).toEqual([
        "set-progress",
        "0.2",
        "--label",
        "THINK",
        "--workspace",
        "workspace-map",
      ]);
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("skips phase mirror when only a surface target is available", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-phase-mirror-surface-only-"));
    const previousHome = process.env.HOME;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const stub = createQueuedCmuxCliExecStub([], { onEmpty: "throw" });

    process.env.HOME = homeDir;
    delete process.env.CMUX_WORKSPACE_ID;
    process.env.CMUX_SURFACE_ID = "surface-env-only";
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      await mirrorCurrentCmuxPhase({ phaseToken: "WORK" });

      expect(stub.calls).toHaveLength(0);
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("best-effort phase mirror swallows nonzero, timeout, and spawn errors", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-phase-mirror-cli-failure-modes-"));
    const previousHome = process.env.HOME;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 2, stdout: "", stderr: "status failed", signal: null, timedOut: false },
        { exitCode: 3, stdout: "", stderr: "progress failed", signal: null, timedOut: false },
        { exitCode: null, stdout: "", stderr: "status timed out", signal: "SIGTERM", timedOut: true },
        { exitCode: null, stdout: "", stderr: "progress timed out", signal: "SIGTERM", timedOut: true },
        new Error("spawn failed status"),
        new Error("spawn failed progress"),
      ],
      { onEmpty: "throw" },
    );

    process.env.HOME = homeDir;
    process.env.CMUX_WORKSPACE_ID = "workspace-env";
    process.env.CMUX_SURFACE_ID = "surface-env";
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      await expect(mirrorCurrentCmuxPhase({ phaseToken: "THINK" })).resolves.toBeUndefined();
      await expect(mirrorCurrentCmuxPhase({ phaseToken: "WORK" })).resolves.toBeUndefined();
      await expect(mirrorCurrentCmuxPhase({ phaseToken: "LEARN" })).resolves.toBeUndefined();

      expect(stub.calls).toHaveLength(6);
      expect(stub.calls.map((call) => call.args)).toEqual([
        ["set-status", "oc_phase", "THINK", "--workspace", "workspace-env"],
        ["set-progress", "0.2", "--label", "THINK", "--workspace", "workspace-env"],
        ["set-status", "oc_phase", "WORK", "--workspace", "workspace-env"],
        ["set-progress", "0.6", "--label", "WORK", "--workspace", "workspace-env"],
        ["set-status", "oc_phase", "LEARN", "--workspace", "workspace-env"],
        ["set-progress", "0.9", "--label", "LEARN", "--workspace", "workspace-env"],
      ]);
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });
});
