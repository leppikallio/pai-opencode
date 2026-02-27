import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  __testOnlyResetCmuxCliState,
  __testOnlySetCmuxCliExec,
} from "../../plugins/pai-cc-hooks/shared/cmux-cli";
import { notifyTargeted } from "../../plugins/pai-cc-hooks/shared/cmux-adapter";
import {
  lookupSessionMapping,
  syncSessionMappingFromEnv,
  upsertSessionMapping,
} from "../../plugins/pai-cc-hooks/shared/cmux-session-map";
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

describe("cmux session map refresh", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
  });

  afterEach(() => {
    __testOnlyResetCmuxCliState();
  });

  test("syncSessionMappingFromEnv upserts from CMUX env ids", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-session-refresh-home-"));
    const previousHome = process.env.HOME;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.HOME = homeDir;
    process.env.CMUX_WORKSPACE_ID = "workspace-env";
    process.env.CMUX_SURFACE_ID = "surface-env";

    try {
      await syncSessionMappingFromEnv("ses_env_sync", "/tmp/project-env");

      const mapping = await lookupSessionMapping({ sessionId: "ses_env_sync" });
      expect(mapping?.workspaceId).toBe("workspace-env");
      expect(mapping?.surfaceId).toBe("surface-env");
      expect(mapping?.cwd).toBe("/tmp/project-env");
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("notifyTargeted does not refresh session map from env", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-session-refresh-home-"));
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
    process.env.CMUX_WORKSPACE_ID = "workspace-fresh";
    process.env.CMUX_SURFACE_ID = "surface-fresh";
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      await upsertSessionMapping({
        sessionId: "ses_refresh",
        workspaceId: "workspace-stale",
        surfaceId: "surface-stale",
      });

      const firstRoute = await notifyTargeted({
        sessionId: "ses_refresh",
        title: "PAI",
        subtitle: "Question",
        body: "Need approval",
      });
      expect(firstRoute).toBe("notification.create_for_target");

      const afterFirst = await lookupSessionMapping({ sessionId: "ses_refresh" });
      expect(afterFirst?.workspaceId).toBe("workspace-stale");
      expect(afterFirst?.surfaceId).toBe("surface-stale");

      delete process.env.CMUX_WORKSPACE_ID;
      delete process.env.CMUX_SURFACE_ID;

      const secondRoute = await notifyTargeted({
        sessionId: "ses_refresh",
        title: "PAI",
        subtitle: "Question",
        body: "Need follow-up",
      });
      expect(secondRoute).toBe("notification.create_for_target");

      expect(stub.calls).toHaveLength(2);
      expect(stub.calls[0]?.args).toEqual([
        "notify",
        "--title",
        "PAI",
        "--subtitle",
        "Question",
        "--body",
        "Need approval",
        "--workspace",
        "workspace-stale",
        "--surface",
        "surface-stale",
      ]);
      expect(stub.calls[1]?.args).toEqual([
        "notify",
        "--title",
        "PAI",
        "--subtitle",
        "Question",
        "--body",
        "Need follow-up",
        "--workspace",
        "workspace-stale",
        "--surface",
        "surface-stale",
      ]);
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });
});
