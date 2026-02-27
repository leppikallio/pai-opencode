import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { emitInterrupt } from "../../hooks/lib/cmux-attention";
import {
  __testOnlyResetCmuxCliState,
  __testOnlySetCmuxCliExec,
} from "../../plugins/pai-cc-hooks/shared/cmux-cli";
import { createQueuedCmuxCliExecStub } from "../helpers/cmux-cli-exec-stub";

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

function cleanupPath(targetPath: string): void {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // Best effort only.
  }
}

describe("cmux attention feature flags", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
  });

  afterEach(() => {
    __testOnlyResetCmuxCliState();
  });

  test("PAI_CMUX_ATTENTION_ENABLED=0 disables attention emissions", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-flags-runtime-"));
    const stub = createQueuedCmuxCliExecStub([], { onEmpty: "throw" });

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousAttentionEnabled = process.env.PAI_CMUX_ATTENTION_ENABLED;

    __testOnlySetCmuxCliExec(stub.exec);

    delete process.env.CMUX_SOCKET_PATH;
    process.env.CMUX_WORKSPACE_ID = "workspace-flags";
    process.env.CMUX_SURFACE_ID = "surface-flags";
    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_ATTENTION_ENABLED = "0";

    try {
      await emitInterrupt({
        eventKey: "QUESTION_PENDING",
        sessionId: "ses_flags_attention_disabled",
        reasonShort: "Need deploy approval",
      });

      expect(stub.calls).toHaveLength(0);
    } finally {
      cleanupPath(runtimeRoot);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_ATTENTION_ENABLED", previousAttentionEnabled);
    }
  });

  test("PAI_CMUX_PROGRESS_ENABLED=0 disables progress mirror only", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-flags-runtime-"));
    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 2, stdout: "", stderr: "target failed", signal: null, timedOut: false },
        { exitCode: 3, stdout: "", stderr: "surface failed", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
      ],
      { onEmpty: "throw" },
    );

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousProgressEnabled = process.env.PAI_CMUX_PROGRESS_ENABLED;
    const previousFlashOnP0 = process.env.PAI_CMUX_FLASH_ON_P0;

    __testOnlySetCmuxCliExec(stub.exec);

    delete process.env.CMUX_SOCKET_PATH;
    process.env.CMUX_WORKSPACE_ID = "workspace-flags";
    process.env.CMUX_SURFACE_ID = "surface-flags";
    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_PROGRESS_ENABLED = "0";
    process.env.PAI_CMUX_FLASH_ON_P0 = "0";

    try {
      await emitInterrupt({
        eventKey: "QUESTION_PENDING",
        sessionId: "ses_flags_progress_disabled",
        reasonShort: "Need deploy approval",
      });

      expect(stub.calls.map((call) => call.args)).toEqual([
        [
          "notify",
          "--title",
          "PAI",
          "--subtitle",
          "Question P0",
          "--body",
          "Need deploy approval",
          "--workspace",
          "workspace-flags",
          "--surface",
          "surface-flags",
        ],
        [
          "notify",
          "--title",
          "PAI",
          "--subtitle",
          "Question P0",
          "--body",
          "Need deploy approval",
          "--surface",
          "surface-flags",
        ],
        ["notify", "--title", "PAI", "--subtitle", "Question P0", "--body", "Need deploy approval"],
        ["set-status", "oc_attention", "QUESTION", "--workspace", "workspace-flags"],
        ["set-status", "oc_phase", "QUESTION", "--workspace", "workspace-flags"],
      ]);
    } finally {
      cleanupPath(runtimeRoot);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_PROGRESS_ENABLED", previousProgressEnabled);
      restoreEnv("PAI_CMUX_FLASH_ON_P0", previousFlashOnP0);
    }
  });

  test("PAI_CMUX_FLASH_ON_P0=0 disables flash nudges", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-flags-runtime-"));
    const stub = createQueuedCmuxCliExecStub(
      Array.from({ length: 9 }, () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        signal: null,
        timedOut: false,
      })),
      { onEmpty: "throw" },
    );

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousFlashOnP0 = process.env.PAI_CMUX_FLASH_ON_P0;

    __testOnlySetCmuxCliExec(stub.exec);

    delete process.env.CMUX_SOCKET_PATH;
    process.env.CMUX_WORKSPACE_ID = "workspace-flags";
    process.env.CMUX_SURFACE_ID = "surface-flags";
    process.env.OPENCODE_ROOT = runtimeRoot;

    try {
      delete process.env.PAI_CMUX_FLASH_ON_P0;
      await emitInterrupt({
        eventKey: "QUESTION_PENDING",
        sessionId: "ses_flags_flash_default",
        reasonShort: "Need deploy approval",
      });

      process.env.PAI_CMUX_FLASH_ON_P0 = "0";
      await emitInterrupt({
        eventKey: "PERMISSION_PENDING",
        sessionId: "ses_flags_flash_disabled",
        reasonShort: "Need permission",
      });

      const flashCalls = stub.calls.filter((call) => call.args[0] === "trigger-flash");
      expect(flashCalls).toHaveLength(1);
      expect(flashCalls[0]?.args).toEqual([
        "trigger-flash",
        "--surface",
        "surface-flags",
        "--workspace",
        "workspace-flags",
      ]);
    } finally {
      cleanupPath(runtimeRoot);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_FLASH_ON_P0", previousFlashOnP0);
    }
  });
});
