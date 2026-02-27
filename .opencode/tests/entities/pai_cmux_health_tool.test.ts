import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  __testOnlyResetCmuxCliState,
  __testOnlySetCmuxCliExec,
} from "../../plugins/pai-cc-hooks/shared/cmux-cli";
import { createQueuedCmuxCliExecStub } from "../helpers/cmux-cli-exec-stub";
import { runCmuxHealth } from "../../../Tools/cmux-health";

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

describe("cmux health tool", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
  });

  afterEach(() => {
    __testOnlySetCmuxCliExec(null);
    __testOnlyResetCmuxCliState();
  });

  test("prints version/env/ping/capabilities/sidebar and breadcrumb path", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-health-tool-"));
    const breadcrumbPath = path.join(runtimeRoot, "MEMORY", "STATE", "cmux-last-error.json");
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 0, stdout: "cmux 0.61.0\n", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "PONG\n", stderr: "", signal: null, timedOut: false },
        {
          exitCode: 0,
          stdout: '{"access_mode":"cmuxOnly","server_version":"0.61.0"}\n',
          stderr: "",
          signal: null,
          timedOut: false,
        },
        {
          exitCode: 0,
          stdout: '{"progress":{"label":"QUESTION","value":1}}\n',
          stderr: "",
          signal: null,
          timedOut: false,
        },
      ],
      { onEmpty: "throw" },
    );

    __testOnlySetCmuxCliExec(stub.exec);

    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.CMUX_WORKSPACE_ID = "workspace-test";
    process.env.CMUX_SURFACE_ID = "surface-test";

    fs.mkdirSync(path.dirname(breadcrumbPath), { recursive: true });
    fs.writeFileSync(
      breadcrumbPath,
      `${JSON.stringify({ kind: "nonzero_exit", reason: "unauthorized" }, null, 2)}\n`,
      "utf-8",
    );

    const output: string[] = [];

    try {
      await runCmuxHealth({
        writeLine: (line) => {
          output.push(line);
        },
      });

      expect(stub.calls.map((call) => call.args)).toEqual([
        ["version"],
        ["ping"],
        ["capabilities", "--json"],
        ["sidebar-state"],
      ]);

      const text = output.join("\n");
      expect(text).toContain("cmux version");
      expect(text).toContain("CMUX_WORKSPACE_ID=workspace-test");
      expect(text).toContain("CMUX_SURFACE_ID=surface-test");
      expect(text).toContain("PONG");
      expect(text).toContain("access_mode=cmuxOnly");
      expect(text).toContain(`cmux_last_error_path=${breadcrumbPath}`);
    } finally {
      __testOnlySetCmuxCliExec(null);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("does not throw and prints degraded diagnostics when cmux commands fail", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-health-tool-"));
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;

    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 2, stdout: "", stderr: "version failed", signal: null, timedOut: false },
        { exitCode: null, stdout: "", stderr: "timeout", signal: "SIGTERM", timedOut: true },
        new Error("exec exploded"),
        { exitCode: 1, stdout: "", stderr: "sidebar failed", signal: null, timedOut: false },
      ],
      { onEmpty: "throw" },
    );

    __testOnlySetCmuxCliExec(stub.exec);
    process.env.OPENCODE_ROOT = runtimeRoot;

    const output: string[] = [];

    try {
      await expect(
        runCmuxHealth({
          writeLine: (line) => {
            output.push(line);
          },
        }),
      ).resolves.toBeUndefined();

      const text = output.join("\n");
      expect(text).toContain("cmux version:");
      expect(text).toContain("kind=nonzero_exit");
      expect(text).toContain("kind=timeout");
      expect(text).toContain("kind=spawn_error");
      expect(text).toContain("- cmux ping failed; verify cmux target/session auth.");
      expect(text).toContain("- capabilities check failed; cmux may be unavailable or unauthenticated.");
      expect(text).toContain("- sidebar-state failed; sidebar/read APIs may not be reachable.");
    } finally {
      __testOnlySetCmuxCliExec(null);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("does not throw on malformed capabilities JSON and reports parse failure", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-health-tool-"));
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;

    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 0, stdout: "cmux 0.61.0\n", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "PONG\n", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "{not-json}\n", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "{}\n", stderr: "", signal: null, timedOut: false },
      ],
      { onEmpty: "throw" },
    );

    __testOnlySetCmuxCliExec(stub.exec);
    process.env.OPENCODE_ROOT = runtimeRoot;

    const output: string[] = [];

    try {
      await expect(
        runCmuxHealth({
          writeLine: (line) => {
            output.push(line);
          },
        }),
      ).resolves.toBeUndefined();

      const text = output.join("\n");
      expect(text).toContain("capabilities_parse_error=");
      expect(text).toContain("- capabilities JSON is malformed; check cmux CLI/version.");
    } finally {
      __testOnlySetCmuxCliExec(null);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("treats blank CMUX env values as unset", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-health-tool-"));
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 0, stdout: "cmux 0.61.0\n", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "PONG\n", stderr: "", signal: null, timedOut: false },
        {
          exitCode: 0,
          stdout: '{"access_mode":"cmuxOnly","server_version":"0.61.0"}\n',
          stderr: "",
          signal: null,
          timedOut: false,
        },
        { exitCode: 0, stdout: "{}\n", stderr: "", signal: null, timedOut: false },
      ],
      { onEmpty: "throw" },
    );

    __testOnlySetCmuxCliExec(stub.exec);
    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.CMUX_WORKSPACE_ID = "   ";
    process.env.CMUX_SURFACE_ID = "\n\t";

    const output: string[] = [];

    try {
      await expect(
        runCmuxHealth({
          writeLine: (line) => {
            output.push(line);
          },
        }),
      ).resolves.toBeUndefined();

      const text = output.join("\n");
      expect(text).toContain("CMUX_WORKSPACE_ID=(unset)");
      expect(text).toContain("CMUX_SURFACE_ID=(unset)");
      expect(text).toContain("- CMUX_WORKSPACE_ID and CMUX_SURFACE_ID are unset in this process.");
    } finally {
      __testOnlySetCmuxCliExec(null);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});
