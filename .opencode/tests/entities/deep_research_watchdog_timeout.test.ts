import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { run_init, watchdog_check } from "../../tools/deep_research_cli.ts";
import { fixturePath, makeToolContext, parseToolJson } from "../helpers/dr-harness";

type TimeoutFixture = {
  run_id: string;
  query: string;
  mode: "quick" | "standard" | "deep";
  sensitivity: "normal" | "restricted" | "no_web";
  stage: string;
  started_at: string;
  now_iso: string;
  reason: string;
  expected: {
    elapsed_s: number;
    timeout_s: number;
    message_includes: string;
    checkpoint_required_fields: string[];
  };
};

async function withDeterministicTempDir<T>(name: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(os.tmpdir(), "dr-phase06-tests", name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("deep_research_watchdog_timeout (entity)", () => {
  test("simulates timeout fixture and writes manifest failure + checkpoint", async () => {
    const fixture = JSON.parse(
      await fs.readFile(fixturePath("runs", "p06-watchdog-timeout", "timeout-event.json"), "utf8"),
    ) as TimeoutFixture;

    await withDeterministicTempDir("watchdog-timeout", async (base) => {
      const initRaw = (await (run_init as any).execute(
        {
          query: fixture.query,
          mode: fixture.mode,
          sensitivity: fixture.sensitivity,
          run_id: fixture.run_id,
          root_override: base,
        },
        makeToolContext(),
      )) as string;
      const init = parseToolJson(initRaw);
      expect(init.ok).toBe(true);

      const manifestPath = String((init as any).manifest_path ?? "");
      expect(manifestPath.length).toBeGreaterThan(0);

      const seededManifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
      const stage = (seededManifest.stage ?? {}) as Record<string, unknown>;
      stage.current = fixture.stage;
      stage.started_at = fixture.started_at;
      stage.last_progress_at = fixture.started_at;
      seededManifest.stage = stage;
      await fs.writeFile(manifestPath, `${JSON.stringify(seededManifest, null, 2)}\n`, "utf8");

      const timeoutRaw = (await (watchdog_check as any).execute(
        {
          manifest_path: manifestPath,
          stage: fixture.stage,
          now_iso: fixture.now_iso,
          reason: fixture.reason,
        },
        makeToolContext(),
      )) as string;
      const timeoutOut = parseToolJson(timeoutRaw);

      expect(timeoutOut.ok).toBe(true);
      expect((timeoutOut as any).timed_out).toBe(true);
      expect((timeoutOut as any).stage).toBe(fixture.stage);
      expect((timeoutOut as any).elapsed_s).toBe(fixture.expected.elapsed_s);
      expect((timeoutOut as any).timeout_s).toBe(fixture.expected.timeout_s);

      const timeoutCheckpointPath = String((timeoutOut as any).checkpoint_path ?? "");
      expect(path.basename(timeoutCheckpointPath)).toBe("timeout-checkpoint.md");
      const checkpointText = await fs.readFile(timeoutCheckpointPath, "utf8");

      for (const requiredField of fixture.expected.checkpoint_required_fields) {
        expect(checkpointText).toContain(requiredField);
      }

      const manifestAfter = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
      expect(String(manifestAfter.status)).toBe("failed");

      const failures = Array.isArray(manifestAfter.failures) ? manifestAfter.failures : [];
      expect(failures.length).toBeGreaterThan(0);

      const latestFailure = failures[failures.length - 1] as Record<string, unknown>;
      expect(String(latestFailure.kind)).toBe("timeout");
      expect(String(latestFailure.stage)).toBe(fixture.stage);
      expect(String(latestFailure.message)).toContain(fixture.expected.message_includes);
    });
  });
});
