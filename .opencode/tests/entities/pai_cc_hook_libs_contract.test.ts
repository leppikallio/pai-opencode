import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { getPaiDir } from "../../hooks/lib/paths";
import { readStdinWithTimeout } from "../../hooks/lib/stdin";
import { getISOTimestamp, getPSTComponents } from "../../hooks/lib/time";

describe("cc hook shared libs contract", () => {
  test("getPaiDir resolves from PAI_DIR and infers runtime root fallback", () => {
    const previousPaiDir = process.env.PAI_DIR;
    const inferredPaiDir = resolve(import.meta.dir, "..", "..");

    try {
      process.env.PAI_DIR = "/tmp/pai-config";
      expect(getPaiDir()).toBe("/tmp/pai-config");

      delete process.env.PAI_DIR;
      expect(getPaiDir()).toBe(inferredPaiDir);

      process.env.PAI_DIR = "${PAI_DIR}";
      expect(getPaiDir()).toBe(inferredPaiDir);
    } finally {
      if (previousPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = previousPaiDir;
      }
    }
  });

  test("readStdinWithTimeout returns empty string on timeout", async () => {
    const result = await readStdinWithTimeout({
      timeoutMs: 1,
      read: () => new Promise<string>(() => {
        // Intentionally never resolve.
      }),
    });

    expect(result).toBe("");
  });

  test("readStdinWithTimeout cancels reader on timeout", async () => {
    let cancelled = false;

    const result = await readStdinWithTimeout({
      timeoutMs: 1,
      read: () => ({
        promise: new Promise<string>(() => {
          // Intentionally never resolve.
        }),
        cancel: () => {
          cancelled = true;
        },
      }),
    });

    expect(result).toBe("");
    expect(cancelled).toBe(true);
  });

  test("getISOTimestamp returns expected shape", () => {
    const timestamp = getISOTimestamp(new Date("2026-01-02T03:04:05.000Z"));
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  test("getPSTComponents exposes six numeric string fields", () => {
    const parts = getPSTComponents(new Date("2026-01-02T03:04:05.000Z"));
    const numericStrings = [
      String(parts.year),
      parts.month,
      parts.day,
      parts.hours,
      parts.minutes,
      parts.seconds,
    ];

    expect(numericStrings).toHaveLength(6);
    for (const value of numericStrings) {
      expect(value).toMatch(/^\d+$/);
    }
  });
});
