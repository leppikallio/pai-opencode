import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  __testOnlyGetStateLockCount,
  shouldEmitAttention,
} from "../../hooks/lib/cmux-attention-store";

function createTempOpencodeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-dedupe-"));
}

async function withTempOpencodeRoot(run: (opencodeRoot: string) => Promise<void>): Promise<void> {
  const opencodeRoot = createTempOpencodeRoot();
  const previousOpencodeRoot = process.env.OPENCODE_ROOT;

  process.env.OPENCODE_ROOT = opencodeRoot;

  try {
    await run(opencodeRoot);
  } finally {
    if (previousOpencodeRoot === undefined) {
      delete process.env.OPENCODE_ROOT;
    } else {
      process.env.OPENCODE_ROOT = previousOpencodeRoot;
    }

    fs.rmSync(opencodeRoot, { recursive: true, force: true });
  }
}

describe("cmux attention dedupe", () => {
  test("suppresses duplicate dedupe key within 2000ms", async () => {
    await withTempOpencodeRoot(async () => {
      const first = await shouldEmitAttention({
        dedupeKey: "question:ses_1:Need approval",
        nowMs: 1_000,
        windowMs: 2_000,
      });
      expect(first).toBe(true);

      const second = await shouldEmitAttention({
        dedupeKey: "question:ses_1:Need approval",
        nowMs: 2_999,
        windowMs: 2_000,
      });
      expect(second).toBe(false);
    });
  });

  test("allows same dedupe key after window", async () => {
    await withTempOpencodeRoot(async () => {
      const first = await shouldEmitAttention({
        dedupeKey: "agent:ses_1:blocked",
        nowMs: 1_000,
        windowMs: 2_000,
      });
      expect(first).toBe(true);

      const second = await shouldEmitAttention({
        dedupeKey: "agent:ses_1:blocked",
        nowMs: 3_001,
        windowMs: 2_000,
      });
      expect(second).toBe(true);
    });
  });

  test("allows same dedupe key exactly at window boundary", async () => {
    await withTempOpencodeRoot(async () => {
      const first = await shouldEmitAttention({
        dedupeKey: "agent:ses_1:boundary",
        nowMs: 1_000,
        windowMs: 2_000,
      });
      expect(first).toBe(true);

      const second = await shouldEmitAttention({
        dedupeKey: "agent:ses_1:boundary",
        nowMs: 3_000,
        windowMs: 2_000,
      });
      expect(second).toBe(true);
    });
  });

  test("does not suppress different dedupe key", async () => {
    await withTempOpencodeRoot(async () => {
      const first = await shouldEmitAttention({
        dedupeKey: "question:ses_1:Need approval",
        nowMs: 1_000,
        windowMs: 2_000,
      });
      expect(first).toBe(true);

      const second = await shouldEmitAttention({
        dedupeKey: "question:ses_1:Need plan",
        nowMs: 1_100,
        windowMs: 2_000,
      });
      expect(second).toBe(true);
    });
  });

  test("writes state under OPENCODE_ROOT/MEMORY/STATE", async () => {
    await withTempOpencodeRoot(async (opencodeRoot) => {
      await shouldEmitAttention({
        dedupeKey: "path-check",
        nowMs: 42_000,
        windowMs: 2_000,
      });

      const expectedPath = path.join(opencodeRoot, "MEMORY", "STATE", "cmux-attention-dedupe.json");
      expect(fs.existsSync(expectedPath)).toBe(true);

      const persisted = JSON.parse(fs.readFileSync(expectedPath, "utf-8")) as {
        lastSeenByKey?: Record<string, number>;
      };
      expect(persisted.lastSeenByKey?.["path-check"]).toBe(42_000);
    });
  });

  test("allows only one emit for concurrent same-key calls", async () => {
    await withTempOpencodeRoot(async () => {
      const dedupeKey = "question:ses_2:parallel";

      const [first, second] = await Promise.all([
        shouldEmitAttention({
          dedupeKey,
          nowMs: 5_000,
          windowMs: 2_000,
        }),
        shouldEmitAttention({
          dedupeKey,
          nowMs: 5_000,
          windowMs: 2_000,
        }),
      ]);

      const totalAllowed = Number(first) + Number(second);
      expect(totalAllowed).toBe(1);
    });
  });

  test("releases lock entries after calls across different OPENCODE_ROOT paths", async () => {
    expect(__testOnlyGetStateLockCount()).toBe(0);

    await withTempOpencodeRoot(async () => {
      await shouldEmitAttention({
        dedupeKey: "lock-check-a",
        nowMs: 10_000,
        windowMs: 2_000,
      });
    });

    expect(__testOnlyGetStateLockCount()).toBe(0);

    await withTempOpencodeRoot(async () => {
      await shouldEmitAttention({
        dedupeKey: "lock-check-b",
        nowMs: 20_000,
        windowMs: 2_000,
      });
    });

    expect(__testOnlyGetStateLockCount()).toBe(0);
  });
});
