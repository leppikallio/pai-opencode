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

function cleanupDir(directoryPath: string): void {
  try {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  } catch {
    // Best effort only.
  }
}

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

describe("cmux attention emit interrupt", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
  });

  afterEach(() => {
    __testOnlyResetCmuxCliState();
  });

  test("uses cmux CLI notify/status/progress/flash for P0 interrupts", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-emit-cli-"));
    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 2, stdout: "", stderr: "target failed", signal: null, timedOut: false },
        { exitCode: 3, stdout: "", stderr: "surface failed", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
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
    const previousAttentionEnabled = process.env.PAI_CMUX_ATTENTION_ENABLED;
    const previousProgressEnabled = process.env.PAI_CMUX_PROGRESS_ENABLED;
    const previousFlashOnP0 = process.env.PAI_CMUX_FLASH_ON_P0;

    __testOnlySetCmuxCliExec(stub.exec);

    delete process.env.CMUX_SOCKET_PATH;
    process.env.CMUX_WORKSPACE_ID = "workspace-123";
    process.env.CMUX_SURFACE_ID = "surface-123";
    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_ATTENTION_ENABLED = "1";
    process.env.PAI_CMUX_PROGRESS_ENABLED = "1";
    process.env.PAI_CMUX_FLASH_ON_P0 = "1";

    try {
      await emitInterrupt({
        eventKey: "QUESTION_PENDING",
        sessionId: "ses_attention_cli",
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
          "workspace-123",
          "--surface",
          "surface-123",
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
          "surface-123",
        ],
        ["notify", "--title", "PAI", "--subtitle", "Question P0", "--body", "Need deploy approval"],
        ["trigger-flash", "--surface", "surface-123", "--workspace", "workspace-123"],
        ["set-status", "oc_attention", "QUESTION", "--workspace", "workspace-123"],
        ["set-status", "oc_phase", "QUESTION", "--workspace", "workspace-123"],
        ["set-progress", "1", "--label", "QUESTION", "--workspace", "workspace-123"],
      ]);
    } finally {
      cleanupDir(runtimeRoot);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_ATTENTION_ENABLED", previousAttentionEnabled);
      restoreEnv("PAI_CMUX_PROGRESS_ENABLED", previousProgressEnabled);
      restoreEnv("PAI_CMUX_FLASH_ON_P0", previousFlashOnP0);
    }
  });
});
