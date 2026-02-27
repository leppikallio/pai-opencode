import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { notifyTargeted } from "../../plugins/pai-cc-hooks/shared/cmux-adapter";
import {
  __testOnlyResetCmuxCliState,
  __testOnlySetCmuxCliExec,
  runCmuxCli,
} from "../../plugins/pai-cc-hooks/shared/cmux-cli";
import {
  __testOnlyConfigureCmuxDebugNow,
  __testOnlyResetCmuxDebugState,
  writeCmuxLastError,
} from "../../plugins/pai-cc-hooks/shared/cmux-debug";
import { createQueuedCmuxCliExecStub } from "../helpers/cmux-cli-exec-stub";

type CmuxBreadcrumb = {
  kind: string;
  route?: string;
  reason?: string;
  fingerprint?: string;
  argv?: string[];
  message?: string;
  stdout?: string;
  stderr?: string;
  happenedAtMs?: number;
};

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

function createRuntimeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cmux-debug-breadcrumbs-"));
}

function readBreadcrumb(root: string): { filePath: string; raw: string; parsed: CmuxBreadcrumb } {
  const filePath = breadcrumbPath(root);
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as CmuxBreadcrumb;
  return { filePath, raw, parsed };
}

function breadcrumbPath(root: string): string {
  return path.join(root, "MEMORY", "STATE", "cmux-last-error.json");
}

function createManualClock(initialMs = 0): { now: () => number; advanceBy: (deltaMs: number) => void } {
  let nowMs = initialMs;
  return {
    now: () => nowMs,
    advanceBy: (deltaMs: number) => {
      nowMs += deltaMs;
    },
  };
}

describe("cmux debug breadcrumbs", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
    __testOnlyResetCmuxDebugState();
  });

  afterEach(() => {
    __testOnlyResetCmuxCliState();
    __testOnlyResetCmuxDebugState();
  });

  test("writes route-none breadcrumb without notification body content", async () => {
    const runtimeRoot = createRuntimeRoot();
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousHome = process.env.HOME;
    const previousCmuxDebug = process.env.PAI_CMUX_DEBUG;
    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const stub = createQueuedCmuxCliExecStub(
      [{ exitCode: 2, stdout: "", stderr: "notify failed", signal: null, timedOut: false }],
      { onEmpty: "throw" },
    );

    const body = "body secret token=route-none-secret";

    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.HOME = runtimeRoot;
    process.env.PAI_CMUX_DEBUG = "1";
    delete process.env.CMUX_SOCKET_PATH;
    delete process.env.CMUX_WORKSPACE_ID;
    delete process.env.CMUX_SURFACE_ID;
    __testOnlySetCmuxCliExec(stub.exec);

    try {
      const route = await notifyTargeted({
        sessionId: "ses_route_none",
        title: "PAI",
        subtitle: "Question",
        body,
      });

      expect(route).toBe("none");

      const breadcrumb = readBreadcrumb(runtimeRoot);
      expect(breadcrumb.filePath).toBe(path.join(runtimeRoot, "MEMORY", "STATE", "cmux-last-error.json"));
      expect(breadcrumb.parsed.kind).toBe("route_none");
      expect(breadcrumb.parsed.route).toBe("none");
      expect(breadcrumb.parsed.reason).toContain("notification routing exhausted");
      expect(breadcrumb.parsed.stdout).toBeUndefined();
      expect(breadcrumb.parsed.stderr).toBeUndefined();
      expect(breadcrumb.raw.includes(body)).toBe(false);
    } finally {
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("HOME", previousHome);
      restoreEnv("PAI_CMUX_DEBUG", previousCmuxDebug);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("writes exec-failure breadcrumb with body/subtitle removed from argv and stdio", async () => {
    const runtimeRoot = createRuntimeRoot();
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousCmuxDebug = process.env.PAI_CMUX_DEBUG;

    const subtitle = "private subtitle phrase";
    const body = "private body phrase with spaces";
    const stub = createQueuedCmuxCliExecStub(
      [
        {
          exitCode: 9,
          stdout: `cli echoed --subtitle="${subtitle}" --body='${body}' ${subtitle} ${body}`,
          stderr: `payload ${JSON.stringify({ subtitle, body })} ${subtitle} ${body}`,
          signal: null,
          timedOut: false,
        },
      ],
      { onEmpty: "throw" },
    );

    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_DEBUG = "1";

    try {
      const result = await runCmuxCli({
        args: ["notify", "--title", "PAI", "--subtitle", subtitle, "--body", body],
        timeoutMs: 500,
        env: { ...process.env },
        exec: stub.exec,
      });

      expect(result.kind).toBe("nonzero_exit");

      const breadcrumb = readBreadcrumb(runtimeRoot);
      expect(breadcrumb.parsed.kind).toBe("nonzero_exit");

      const argv = breadcrumb.parsed.argv ?? [];
      const subtitleFlagIndex = argv.indexOf("--subtitle");
      expect(subtitleFlagIndex).toBeGreaterThanOrEqual(0);
      expect(argv[subtitleFlagIndex + 1]).toBe("[REDACTED]");

      const bodyFlagIndex = argv.indexOf("--body");
      expect(bodyFlagIndex).toBeGreaterThanOrEqual(0);
      expect(argv[bodyFlagIndex + 1]).toBe("[REDACTED]");

      expect((breadcrumb.parsed.stdout ?? "").includes(subtitle)).toBe(false);
      expect((breadcrumb.parsed.stdout ?? "").includes(body)).toBe(false);
      expect((breadcrumb.parsed.stderr ?? "").includes(subtitle)).toBe(false);
      expect((breadcrumb.parsed.stderr ?? "").includes(body)).toBe(false);

      expect(breadcrumb.raw.includes(body)).toBe(false);
      expect(breadcrumb.raw.includes(subtitle)).toBe(false);

      expect((breadcrumb.parsed.message ?? "").includes(subtitle)).toBe(false);
      expect((breadcrumb.parsed.message ?? "").includes(body)).toBe(false);

      expect(breadcrumb.parsed.stdout ?? "").toBe("");
      expect(breadcrumb.parsed.stderr ?? "").toBe("");
    } finally {
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_DEBUG", previousCmuxDebug);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("suppresses breadcrumb message when sensitive flags are present", async () => {
    const runtimeRoot = createRuntimeRoot();
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousCmuxDebug = process.env.PAI_CMUX_DEBUG;

    const subtitle = "y3";
    const body = "x2";
    const message = `cmux failed with subtitle=${subtitle} body=${body}`;

    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_DEBUG = "1";

    try {
      await writeCmuxLastError({
        kind: "nonzero_exit",
        argv: ["cmux", "notify", "--subtitle", subtitle, "--body", body],
        exitCode: 4,
        signal: null,
        message,
        stdout: `stdout ${subtitle} ${body}`,
        stderr: `stderr ${subtitle} ${body}`,
      });

      const breadcrumb = readBreadcrumb(runtimeRoot);
      expect(breadcrumb.parsed.message).toBeUndefined();
      expect(breadcrumb.parsed.stdout ?? "").toBe("");
      expect(breadcrumb.parsed.stderr ?? "").toBe("");
      expect(breadcrumb.raw.includes(message)).toBe(false);
      expect(breadcrumb.raw.includes(subtitle)).toBe(false);
      expect(breadcrumb.raw.includes(body)).toBe(false);
    } finally {
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_DEBUG", previousCmuxDebug);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("does not persist echoed short body/subtitle values in breadcrumb raw JSON", async () => {
    const runtimeRoot = createRuntimeRoot();
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousCmuxDebug = process.env.PAI_CMUX_DEBUG;

    const subtitle = "x";
    const body = "ok";
    const stub = createQueuedCmuxCliExecStub(
      [
        {
          exitCode: 3,
          stdout: `echo subtitle=${subtitle} body=${body}`,
          stderr: `echo-json ${JSON.stringify({ subtitle, body })} ${subtitle}:${body}`,
          signal: null,
          timedOut: false,
        },
      ],
      { onEmpty: "throw" },
    );

    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_DEBUG = "1";

    try {
      const result = await runCmuxCli({
        args: ["notify", "--title", "PAI", "--subtitle", subtitle, "--body", body],
        timeoutMs: 500,
        env: { ...process.env },
        exec: stub.exec,
      });

      expect(result.kind).toBe("nonzero_exit");

      const breadcrumb = readBreadcrumb(runtimeRoot);
      expect(breadcrumb.parsed.kind).toBe("nonzero_exit");
      expect(breadcrumb.parsed.message).toBeUndefined();
      expect(breadcrumb.parsed.stdout ?? "").toBe("");
      expect(breadcrumb.parsed.stderr ?? "").toBe("");

      expect(breadcrumb.raw.includes(body)).toBe(false);
      expect(breadcrumb.raw.includes(`"${subtitle}"`)).toBe(false);
      expect((breadcrumb.parsed.message ?? "").includes(body)).toBe(false);
      expect((breadcrumb.parsed.message ?? "").includes(subtitle)).toBe(false);
    } finally {
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_DEBUG", previousCmuxDebug);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("does not write breadcrumb file when PAI_CMUX_DEBUG is not enabled", async () => {
    const runtimeRoot = createRuntimeRoot();
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousCmuxDebug = process.env.PAI_CMUX_DEBUG;

    const stub = createQueuedCmuxCliExecStub(
      [{ exitCode: 5, stdout: "", stderr: "", signal: null, timedOut: false }],
      { onEmpty: "throw" },
    );

    process.env.OPENCODE_ROOT = runtimeRoot;
    delete process.env.PAI_CMUX_DEBUG;

    try {
      const result = await runCmuxCli({
        args: ["notify", "--title", "PAI"],
        timeoutMs: 300,
        env: { ...process.env },
        exec: stub.exec,
      });

      expect(result.kind).toBe("nonzero_exit");
      expect(fs.existsSync(breadcrumbPath(runtimeRoot))).toBe(false);
    } finally {
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_DEBUG", previousCmuxDebug);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("swallows breadcrumb write failures and remains best-effort", async () => {
    const runtimeRoot = createRuntimeRoot();
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousCmuxDebug = process.env.PAI_CMUX_DEBUG;

    const blockedMemoryPath = path.join(runtimeRoot, "MEMORY");
    fs.writeFileSync(blockedMemoryPath, "blocked", "utf-8");

    const stub = createQueuedCmuxCliExecStub(
      [{ exitCode: 6, stdout: "", stderr: "", signal: null, timedOut: false }],
      { onEmpty: "throw" },
    );

    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_DEBUG = "1";

    try {
      await expect(
        runCmuxCli({
          args: ["notify", "--title", "PAI"],
          timeoutMs: 300,
          env: { ...process.env },
          exec: stub.exec,
        }),
      ).resolves.toMatchObject({ kind: "nonzero_exit" });

      expect(fs.existsSync(breadcrumbPath(runtimeRoot))).toBe(false);
      expect(fs.statSync(blockedMemoryPath).isFile()).toBe(true);
    } finally {
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_DEBUG", previousCmuxDebug);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("does not throttle distinct failure kinds with same sanitized argv", async () => {
    const runtimeRoot = createRuntimeRoot();
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousCmuxDebug = process.env.PAI_CMUX_DEBUG;

    const clock = createManualClock(20_000);
    __testOnlyConfigureCmuxDebugNow(clock.now);

    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 2, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: null, stdout: "", stderr: "", signal: "SIGTERM", timedOut: true },
      ],
      { onEmpty: "throw" },
    );

    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_DEBUG = "1";

    try {
      await runCmuxCli({
        args: ["notify", "--body", "same"],
        timeoutMs: 300,
        env: { ...process.env },
        exec: stub.exec,
      });
      const first = readBreadcrumb(runtimeRoot).parsed;
      expect(first.kind).toBe("nonzero_exit");

      clock.advanceBy(1_000);
      await runCmuxCli({
        args: ["notify", "--body", "same"],
        timeoutMs: 300,
        env: { ...process.env },
        exec: stub.exec,
      });
      const second = readBreadcrumb(runtimeRoot).parsed;

      expect(second.kind).toBe("timeout");
      expect(second.happenedAtMs).toBeGreaterThan(first.happenedAtMs ?? 0);
      expect(second.fingerprint).not.toBe(first.fingerprint);
    } finally {
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_DEBUG", previousCmuxDebug);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("throttles identical sanitized argv writes for two seconds", async () => {
    const runtimeRoot = createRuntimeRoot();
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousCmuxDebug = process.env.PAI_CMUX_DEBUG;

    const clock = createManualClock(10_000);
    __testOnlyConfigureCmuxDebugNow(clock.now);

    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 7, stdout: "", stderr: "token=one", signal: null, timedOut: false },
        { exitCode: 7, stdout: "", stderr: "token=two", signal: null, timedOut: false },
        { exitCode: 7, stdout: "", stderr: "token=three", signal: null, timedOut: false },
      ],
      { onEmpty: "throw" },
    );

    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_DEBUG = "1";

    try {
      await runCmuxCli({
        args: ["notify", "--body", "throttle body"],
        timeoutMs: 300,
        env: { ...process.env },
        exec: stub.exec,
      });
      const first = readBreadcrumb(runtimeRoot).parsed;

      clock.advanceBy(1_000);
      await runCmuxCli({
        args: ["notify", "--body", "throttle body"],
        timeoutMs: 300,
        env: { ...process.env },
        exec: stub.exec,
      });
      const second = readBreadcrumb(runtimeRoot).parsed;

      expect(second.happenedAtMs).toBe(first.happenedAtMs);

      clock.advanceBy(2_000);
      await runCmuxCli({
        args: ["notify", "--body", "throttle body"],
        timeoutMs: 300,
        env: { ...process.env },
        exec: stub.exec,
      });
      const third = readBreadcrumb(runtimeRoot).parsed;

      expect(third.happenedAtMs).toBeGreaterThan(first.happenedAtMs ?? 0);
    } finally {
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_DEBUG", previousCmuxDebug);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});
