import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  __testOnlyResetCmuxCliState,
  __testOnlySetCmuxCliExec,
} from "../../plugins/pai-cc-hooks/shared/cmux-cli";
import { notify, notifyTargeted } from "../../plugins/pai-cc-hooks/shared/cmux-adapter";
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

describe("cmux adapter", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
  });

  afterEach(() => {
    __testOnlyResetCmuxCliState();
  });

  test("targets mapped surface when env surface is missing", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-adapter-home-"));
    const previousHome = process.env.HOME;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const stub = createQueuedCmuxCliExecStub(
      [{ exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false }],
      { onEmpty: "throw" },
    );

    process.env.HOME = homeDir;
    delete process.env.CMUX_WORKSPACE_ID;
    delete process.env.CMUX_SURFACE_ID;
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      await upsertSessionMapping({
        sessionId: "ses_123",
        workspaceId: "workspace-123",
        surfaceId: "surface-123",
      });

      await notify({
        sessionId: "ses_123",
        title: "OpenCode",
        subtitle: "Question",
        body: "Approval needed",
      });

      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0]?.args).toEqual([
        "notify",
        "--title",
        "OpenCode",
        "--subtitle",
        "Question",
        "--body",
        "Approval needed",
        "--workspace",
        "workspace-123",
        "--surface",
        "surface-123",
      ]);
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("uses untargeted notification when no mapping target exists", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-adapter-home-empty-"));
    const previousHome = process.env.HOME;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const stub = createQueuedCmuxCliExecStub(
      [{ exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false }],
      { onEmpty: "throw" },
    );

    process.env.HOME = homeDir;
    delete process.env.CMUX_WORKSPACE_ID;
    delete process.env.CMUX_SURFACE_ID;
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      const route = await notifyTargeted({
        sessionId: "ses_no_map",
        title: "OpenCode",
        subtitle: "Question",
        body: "Approval needed",
      });

      expect(route).toBe("notification.create");
      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0]?.args).toEqual([
        "notify",
        "--title",
        "OpenCode",
        "--subtitle",
        "Question",
        "--body",
        "Approval needed",
      ]);
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("falls back through workspace+surface, surface, then untargeted", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-adapter-home-fallback-"));
    const previousHome = process.env.HOME;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 2, stdout: "", stderr: "target failed", signal: null, timedOut: false },
        { exitCode: 3, stdout: "", stderr: "surface failed", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
      ],
      { onEmpty: "throw" },
    );

    process.env.HOME = homeDir;
    delete process.env.CMUX_WORKSPACE_ID;
    delete process.env.CMUX_SURFACE_ID;
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      await upsertSessionMapping({
        sessionId: "ses_fallback",
        workspaceId: "workspace-fallback",
        surfaceId: "surface-fallback",
      });

      await notify({
        sessionId: "ses_fallback",
        title: "OpenCode",
        subtitle: "Question",
        body: "Need fallback",
      });

      expect(stub.calls).toHaveLength(3);
      expect(stub.calls[0]?.args).toEqual([
        "notify",
        "--title",
        "OpenCode",
        "--subtitle",
        "Question",
        "--body",
        "Need fallback",
        "--workspace",
        "workspace-fallback",
        "--surface",
        "surface-fallback",
      ]);
      expect(stub.calls[1]?.args).toEqual([
        "notify",
        "--title",
        "OpenCode",
        "--subtitle",
        "Question",
        "--body",
        "Need fallback",
        "--surface",
        "surface-fallback",
      ]);
      expect(stub.calls[2]?.args).toEqual([
        "notify",
        "--title",
        "OpenCode",
        "--subtitle",
        "Question",
        "--body",
        "Need fallback",
      ]);
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("returns none when all notification routes fail", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-adapter-home-none-"));
    const previousHome = process.env.HOME;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 2, stdout: "", stderr: "target failed", signal: null, timedOut: false },
        { exitCode: 3, stdout: "", stderr: "surface failed", signal: null, timedOut: false },
        { exitCode: 4, stdout: "", stderr: "notify failed", signal: null, timedOut: false },
      ],
      { onEmpty: "throw" },
    );

    process.env.HOME = homeDir;
    delete process.env.CMUX_WORKSPACE_ID;
    delete process.env.CMUX_SURFACE_ID;
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      await upsertSessionMapping({
        sessionId: "ses_all_fail",
        workspaceId: "workspace-fail",
        surfaceId: "surface-fail",
      });

      const route = await notifyTargeted({
        sessionId: "ses_all_fail",
        title: "OpenCode",
        subtitle: "Session",
        body: "Background complete",
      });

      expect(route).toBe("none");
      expect(stub.calls).toHaveLength(3);
      expect(stub.calls[2]?.args).toEqual([
        "notify",
        "--title",
        "OpenCode",
        "--subtitle",
        "Session",
        "--body",
        "Background complete",
      ]);
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });
});
