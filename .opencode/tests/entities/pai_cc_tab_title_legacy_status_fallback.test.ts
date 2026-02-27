import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { renameCurrentCmuxSurfaceTitle } from "../../hooks/lib/cmux-v2";
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

describe("cmux tab title rename", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
  });

  afterEach(() => {
    __testOnlyResetCmuxCliState();
  });

  test("renames via CLI using map target before env target", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-title-rename-cli-"));
    const previousHome = process.env.HOME;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const stub = createQueuedCmuxCliExecStub(
      [{ exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false }],
      { onEmpty: "throw" },
    );

    process.env.HOME = homeDir;
    process.env.CMUX_WORKSPACE_ID = "workspace-env";
    process.env.CMUX_SURFACE_ID = "surface-env";
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      await upsertSessionMapping({
        sessionId: "ses_rename",
        workspaceId: "workspace-map",
        surfaceId: "surface-map",
      });

      await renameCurrentCmuxSurfaceTitle("🧠 Legacy Title", { sessionId: "ses_rename" });

      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0]?.args).toEqual([
        "rename-tab",
        "--workspace",
        "workspace-map",
        "--surface",
        "surface-map",
        "--",
        "🧠 Legacy Title",
      ]);
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("renames via CLI using surface-only env target when session is absent", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-title-rename-cli-surface-only-"));
    const previousHome = process.env.HOME;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const stub = createQueuedCmuxCliExecStub(
      [{ exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false }],
      { onEmpty: "throw" },
    );

    process.env.HOME = homeDir;
    delete process.env.CMUX_WORKSPACE_ID;
    process.env.CMUX_SURFACE_ID = "surface-env-only";
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      await renameCurrentCmuxSurfaceTitle("Surface-only title");

      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0]?.args).toEqual([
        "rename-tab",
        "--surface",
        "surface-env-only",
        "--",
        "Surface-only title",
      ]);
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("best-effort rename swallows nonzero, timeout, and spawn errors", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-title-rename-cli-failure-modes-"));
    const previousHome = process.env.HOME;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 9, stdout: "", stderr: "rename failed", signal: null, timedOut: false },
        { exitCode: null, stdout: "", stderr: "timed out", signal: "SIGTERM", timedOut: true },
        new Error("spawn exploded"),
      ],
      { onEmpty: "throw" },
    );

    process.env.HOME = homeDir;
    process.env.CMUX_WORKSPACE_ID = "workspace-env";
    process.env.CMUX_SURFACE_ID = "surface-env";
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      await expect(renameCurrentCmuxSurfaceTitle("title one")).resolves.toBeUndefined();
      await expect(renameCurrentCmuxSurfaceTitle("title two")).resolves.toBeUndefined();
      await expect(renameCurrentCmuxSurfaceTitle("title three")).resolves.toBeUndefined();

      expect(stub.calls).toHaveLength(3);
      expect(stub.calls.map((call) => call.args)).toEqual([
        ["rename-tab", "--workspace", "workspace-env", "--surface", "surface-env", "--", "title one"],
        ["rename-tab", "--workspace", "workspace-env", "--surface", "surface-env", "--", "title two"],
        ["rename-tab", "--workspace", "workspace-env", "--surface", "surface-env", "--", "title three"],
      ]);
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });
});
