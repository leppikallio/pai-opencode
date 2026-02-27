import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  __testOnlyConfigureNow,
  __testOnlyResetCmuxCliState,
  __testOnlySetCmuxCliExec,
  runCmuxCli,
} from "../../plugins/pai-cc-hooks/shared/cmux-cli";
import { createQueuedCmuxCliExecStub } from "../helpers/cmux-cli-exec-stub";

function createBaseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.PAI_CMUX_BIN;
  return env;
}

function createEnoent(bin: string): NodeJS.ErrnoException {
  const error = new Error(`spawn ${bin} ENOENT`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

function createManualClock(initialMs = 0): { now: () => number; advanceBy: (deltaMs: number) => void } {
  let nowMs = initialMs;
  return {
    now: () => nowMs,
    advanceBy: (deltaMs) => {
      nowMs += deltaMs;
    },
  };
}

describe("cmux cli runner", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
  });

  afterEach(() => {
    __testOnlyResetCmuxCliState();
  });

  test("uses absolute PAI_CMUX_BIN override and keeps argv tokens intact", async () => {
    const stub = createQueuedCmuxCliExecStub(
      [
        {
          exitCode: 0,
          stdout: "PONG\n",
          stderr: "",
          signal: null,
          timedOut: false,
        },
      ],
      { onEmpty: "throw" },
    );

    const body = "body with spaces and \"quotes\" stays one token";
    const env = {
      ...createBaseEnv(),
      PAI_CMUX_BIN: "/opt/homebrew/bin/cmux",
    };

    const result = await runCmuxCli({
      args: ["notify", "--body", body],
      timeoutMs: 500,
      env,
      exec: stub.exec,
    });

    expect(result.kind).toBe("ok");
    expect(result.argv).toEqual(["/opt/homebrew/bin/cmux", "notify", "--body", body]);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.bin).toBe("/opt/homebrew/bin/cmux");
    expect(stub.calls[0]?.args).toEqual(["notify", "--body", body]);
  });

  test("returns timeout when exec reports timedOut", async () => {
    const stub = createQueuedCmuxCliExecStub(
      [
        {
          exitCode: null,
          stdout: "",
          stderr: "timed out",
          signal: "SIGTERM",
          timedOut: true,
        },
      ],
      { onEmpty: "throw" },
    );

    const result = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 250,
      env: createBaseEnv(),
      exec: stub.exec,
    });

    expect(result.kind).toBe("timeout");
    expect(result.signal).toBe("SIGTERM");
    expect(result.message).toContain("timed out");
  });

  test("classifies non-zero exits as nonzero_exit", async () => {
    const stub = createQueuedCmuxCliExecStub(
      [
        {
          exitCode: 2,
          stdout: "",
          stderr: "invalid args",
          signal: null,
          timedOut: false,
        },
      ],
      { onEmpty: "throw" },
    );

    const result = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 250,
      env: createBaseEnv(),
      exec: stub.exec,
    });

    expect(result.kind).toBe("nonzero_exit");
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain("code 2");
  });

  test("normalizes invalid timeoutMs values to 1000 before exec", async () => {
    const stub = createQueuedCmuxCliExecStub(
      [
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
        { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
      ],
      { onEmpty: "throw" },
    );

    const invalidTimeouts = [0, Number.NaN, -25];
    for (const timeoutMs of invalidTimeouts) {
      const result = await runCmuxCli({
        args: ["ping"],
        timeoutMs,
        env: createBaseEnv(),
        exec: stub.exec,
      });
      expect(result.kind).toBe("ok");
    }

    expect(stub.calls).toHaveLength(3);
    expect(stub.calls.map((call) => call.timeoutMs)).toEqual([1_000, 1_000, 1_000]);
  });

  test("never throws when exec throws; returns spawn_error", async () => {
    const stub = createQueuedCmuxCliExecStub([new Error("unexpected spawn failure")], {
      onEmpty: "throw",
    });

    const result = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 250,
      env: createBaseEnv(),
      exec: stub.exec,
    });

    expect(result.kind).toBe("spawn_error");
    expect(result.message).toContain("unexpected spawn failure");
  });

  test("rejects relative PAI_CMUX_BIN with a clear spawn_error", async () => {
    const stub = createQueuedCmuxCliExecStub(
      [
        {
          exitCode: 0,
          stdout: "",
          stderr: "",
          signal: null,
          timedOut: false,
        },
      ],
      { onEmpty: "throw" },
    );

    const result = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 300,
      env: {
        ...createBaseEnv(),
        PAI_CMUX_BIN: "relative/cmux",
      },
      exec: stub.exec,
    });

    expect(result.kind).toBe("spawn_error");
    expect(result.message).toContain("PAI_CMUX_BIN");
    expect(result.message).toContain("absolute path");
    expect(stub.calls).toHaveLength(0);
  });

  test("caches ENOENT not_found with TTL using injected clock", async () => {
    const clock = createManualClock(10_000);
    __testOnlyConfigureNow(clock.now);

    const stub = createQueuedCmuxCliExecStub(
      [
        createEnoent("cmux"),
        {
          exitCode: 0,
          stdout: "PONG\n",
          stderr: "",
          signal: null,
          timedOut: false,
        },
      ],
      { onEmpty: "throw" },
    );

    const first = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 300,
      env: createBaseEnv(),
      exec: stub.exec,
    });
    expect(first.kind).toBe("not_found");
    expect(stub.calls).toHaveLength(1);

    const second = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 300,
      env: createBaseEnv(),
      exec: stub.exec,
    });
    expect(second.kind).toBe("not_found");
    expect(stub.calls).toHaveLength(1);

    clock.advanceBy(4_999);
    const stillCached = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 300,
      env: createBaseEnv(),
      exec: stub.exec,
    });
    expect(stillCached.kind).toBe("not_found");
    expect(stub.calls).toHaveLength(1);

    clock.advanceBy(1);
    const afterTtl = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 300,
      env: createBaseEnv(),
      exec: stub.exec,
    });
    expect(afterTtl.kind).toBe("ok");
    expect(stub.calls).toHaveLength(2);
  });

  test("availability cache keys by resolved binary identity", async () => {
    const clock = createManualClock(1_000);
    __testOnlyConfigureNow(clock.now);

    const stub = createQueuedCmuxCliExecStub(
      [
        createEnoent("cmux"),
        {
          exitCode: 0,
          stdout: "PONG\n",
          stderr: "",
          signal: null,
          timedOut: false,
        },
      ],
      { onEmpty: "throw" },
    );

    const defaultPath = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 300,
      env: createBaseEnv(),
      exec: stub.exec,
    });
    expect(defaultPath.kind).toBe("not_found");

    const absoluteOverride = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 300,
      env: {
        ...createBaseEnv(),
        PAI_CMUX_BIN: "/tmp/custom-cmux",
      },
      exec: stub.exec,
    });

    expect(absoluteOverride.kind).toBe("ok");
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[0]?.bin).toBe("cmux");
    expect(stub.calls[1]?.bin).toBe("/tmp/custom-cmux");
  });

  test("test-only reset clears availability cache and test exec override", async () => {
    const clock = createManualClock(5_000);
    __testOnlyConfigureNow(clock.now);

    const stub = createQueuedCmuxCliExecStub(
      [
        createEnoent("cmux"),
        {
          exitCode: 0,
          stdout: "PONG\n",
          stderr: "",
          signal: null,
          timedOut: false,
        },
      ],
      { onEmpty: "throw" },
    );

    __testOnlySetCmuxCliExec(stub.exec);

    const first = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 300,
      env: createBaseEnv(),
    });
    expect(first.kind).toBe("not_found");

    const cached = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 300,
      env: createBaseEnv(),
    });
    expect(cached.kind).toBe("not_found");
    expect(stub.calls).toHaveLength(1);

    __testOnlyResetCmuxCliState();
    __testOnlyConfigureNow(clock.now);
    __testOnlySetCmuxCliExec(stub.exec);

    const afterReset = await runCmuxCli({
      args: ["ping"],
      timeoutMs: 300,
      env: createBaseEnv(),
    });
    expect(afterReset.kind).toBe("ok");
    expect(stub.calls).toHaveLength(2);
  });
});
