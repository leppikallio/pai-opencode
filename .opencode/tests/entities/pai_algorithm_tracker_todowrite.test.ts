import { describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { updateAlgorithmTrackerState } from "../../hooks/lib/algorithm-tracker";

async function withTempPaiDir<T>(name: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(os.tmpdir(), "pai-algorithm-tracker-tests", name);
  await rm(dir, { recursive: true, force: true });

  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("AlgorithmTracker TodoWrite state updates", () => {
  test("writes per-session criteria state for TodoWrite payload", async () => {
    await withTempPaiDir("todowrite", async (paiDir) => {
      const result = await updateAlgorithmTrackerState(
        {
          session_id: "session-123",
          tool_name: "TodoWrite",
          tool_input: {
            todos: [{ content: "No credentials exposed in git commit history", status: "pending" }],
          },
        },
        {
          paiDir,
          now: new Date("2026-02-20T12:00:00.000Z"),
        },
      );

      expect(result.updated).toBe(true);
      expect(result.statePath).toBeDefined();

      const rawState = await readFile(String(result.statePath), "utf8");
      const state = JSON.parse(rawState) as {
        sessionId: string;
        updatedAt: string;
        criteria: Array<{ id: string; description: string; status: string }>;
      };

      expect(state.sessionId).toBe("session-123");
      expect(state.updatedAt).toBe("2026-02-20T12:00:00.000Z");
      expect(Array.isArray(state.criteria)).toBe(true);
      expect(state.criteria).toHaveLength(1);
      expect(state.criteria[0]?.description).toBe("No credentials exposed in git commit history");
      expect(state.criteria[0]?.status).toBe("pending");
      expect(typeof state.criteria[0]?.id).toBe("string");
      expect(String(state.criteria[0]?.id).length).toBeGreaterThan(0);

      const globalStatePath = path.join(paiDir, "MEMORY", "STATE", "algorithm-state.json");
      const rawGlobalState = await readFile(globalStatePath, "utf8");
      const globalState = JSON.parse(rawGlobalState) as {
        sessionId?: string;
        effortLevel?: string;
        criteria?: Array<{ description: string }>;
      };

      expect(globalState.sessionId).toBe("session-123");
      expect(Array.isArray(globalState.criteria)).toBe(true);
      expect(globalState.criteria?.[0]?.description).toBe("No credentials exposed in git commit history");
    });
  });
});
