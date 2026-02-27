import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { __testOnlyResetCmuxCliState, runCmuxCli } from "../../plugins/pai-cc-hooks/shared/cmux-cli";

const ENV_BIN = "/usr/bin/env";

function createBaseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.PAI_CMUX_BIN;
  return env;
}

describe("cmux cli runner spawn integration timeout", () => {
  beforeEach(() => {
    __testOnlyResetCmuxCliState();
  });

  afterEach(() => {
    __testOnlyResetCmuxCliState();
  });

  test("returns timeout in bounded time when child ignores SIGTERM", async () => {
    const script = [
      "process.on('SIGTERM', () => {});",
      "setInterval(() => {}, 1_000);",
    ].join("\n");

    const startedAt = Date.now();
    const result = await runCmuxCli({
      args: ["node", "-e", script],
      timeoutMs: 40,
      env: {
        ...createBaseEnv(),
        PAI_CMUX_BIN: ENV_BIN,
      },
    });
    const elapsedMs = Date.now() - startedAt;

    expect(result.kind).toBe("timeout");
    // OS/process timing can produce different close signals (or none if we finalize without close).
    expect(result.signal === "SIGTERM" || result.signal === "SIGKILL" || result.signal === null).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(40);
    expect(elapsedMs).toBeLessThan(700);
  });
});
