import { describe, expect, test } from "bun:test";

import { isEnvFlagEnabled, isMemoryParityEnabled } from "../../plugins/lib/env-flags";

function withEnv(name: string, value: string | undefined, run: () => void): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;

  try {
    run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

describe("isEnvFlagEnabled", () => {
  test("defaultEnabled=true disables only explicit off values", () => {
    for (const value of ["0", "false", "off", "no", " FALSE ", "No"]) {
      withEnv("PAI_TEST_FLAG", value, () => {
        expect(isEnvFlagEnabled("PAI_TEST_FLAG", true)).toBe(false);
      });
    }

    for (const value of [undefined, "", "1", "true", "on", "yes", "random"]) {
      withEnv("PAI_TEST_FLAG", value, () => {
        expect(isEnvFlagEnabled("PAI_TEST_FLAG", true)).toBe(true);
      });
    }
  });

  test("defaultEnabled=false enables only explicit on values", () => {
    for (const value of ["1", "true", "on", "yes", " TRUE ", "YeS"]) {
      withEnv("PAI_TEST_FLAG", value, () => {
        expect(isEnvFlagEnabled("PAI_TEST_FLAG", false)).toBe(true);
      });
    }

    for (const value of [undefined, "", "0", "false", "off", "no", "random"]) {
      withEnv("PAI_TEST_FLAG", value, () => {
        expect(isEnvFlagEnabled("PAI_TEST_FLAG", false)).toBe(false);
      });
    }
  });

  test("unknown non-empty values follow the default", () => {
    withEnv("PAI_TEST_FLAG", "random", () => {
      expect(isEnvFlagEnabled("PAI_TEST_FLAG", true)).toBe(true);
      expect(isEnvFlagEnabled("PAI_TEST_FLAG", false)).toBe(false);
    });
  });
});

describe("isMemoryParityEnabled", () => {
  test("defaults to enabled when env var is unset or empty", () => {
    withEnv("PAI_ENABLE_MEMORY_PARITY", undefined, () => {
      expect(isMemoryParityEnabled()).toBe(true);
    });
    withEnv("PAI_ENABLE_MEMORY_PARITY", "", () => {
      expect(isMemoryParityEnabled()).toBe(true);
    });
  });

  test("respects explicit off values", () => {
    for (const value of ["0", "false", "off", "no"]) {
      withEnv("PAI_ENABLE_MEMORY_PARITY", value, () => {
        expect(isMemoryParityEnabled()).toBe(false);
      });
    }
  });
});
