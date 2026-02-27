import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { setTabState } from "../../hooks/lib/tab-state";
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

describe("pai_cc_tab_state cmux rename", () => {
  test("setTabState renames the current cmux surface", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pai-tab-state-cmux-"));
    fs.mkdirSync(path.join(runtimeRoot, "hooks"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, "skills"), { recursive: true });
    const stub = createQueuedCmuxCliExecStub(
      [{ exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false }],
      { onEmpty: "throw" },
    );

    const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.OPENCODE_ROOT = runtimeRoot;
    delete process.env.CMUX_WORKSPACE_ID;
    process.env.CMUX_SURFACE_ID = "surface-S1";
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      await setTabState({ sessionId: "S1", title: "🧠 X", state: "thinking" });

      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0]?.args).toEqual(["rename-tab", "--surface", "surface-S1", "--", "🧠 X"]);
    } finally {
      __testOnlyResetCmuxCliState();
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
      restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });
});
