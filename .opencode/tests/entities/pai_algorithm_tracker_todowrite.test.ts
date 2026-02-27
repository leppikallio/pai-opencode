import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function restoreFile(filePath: string, content: string | null): Promise<void> {
  if (content == null) {
    await rm(filePath, { force: true });
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
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

  test("ignores cwd when runtime env vars are absent", async () => {
    const previousCwd = process.cwd();
    const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
    const previousOpenCodeConfigRoot = process.env.OPENCODE_CONFIG_ROOT;

    const runtimeRoot = path.resolve(import.meta.dir, "..", "..");
    const workspaceDir = path.join(os.tmpdir(), "pai-algorithm-tracker-cwd", `run-${Date.now()}`);
    const sessionId = `cwd-regression-${Date.now()}`;
    const sessionStatePath = path.join(runtimeRoot, "MEMORY", "STATE", "algorithm-tracker", `${sessionId}.json`);
    const globalStatePath = path.join(runtimeRoot, "MEMORY", "STATE", "algorithm-state.json");

    const previousSessionState = await readFileIfExists(sessionStatePath);
    const previousGlobalState = await readFileIfExists(globalStatePath);

    await rm(workspaceDir, { recursive: true, force: true });
    await mkdir(workspaceDir, { recursive: true });

    try {
      delete process.env.OPENCODE_ROOT;
      delete process.env.OPENCODE_CONFIG_ROOT;
      process.chdir(workspaceDir);

      const result = await updateAlgorithmTrackerState(
        {
          session_id: sessionId,
          tool_name: "TodoWrite",
          tool_input: {
            todos: [{ content: "No credentials exposed in git commit history", status: "pending" }],
          },
        },
        {
          now: new Date("2026-02-27T12:00:00.000Z"),
        },
      );

      expect(result.updated).toBe(true);
      expect(String(result.statePath).startsWith(path.join(runtimeRoot, "MEMORY", "STATE", "algorithm-tracker"))).toBe(true);
      expect(String(result.statePath).startsWith(workspaceDir)).toBe(false);
    } finally {
      process.chdir(previousCwd);

      if (previousOpenCodeRoot === undefined) {
        delete process.env.OPENCODE_ROOT;
      } else {
        process.env.OPENCODE_ROOT = previousOpenCodeRoot;
      }

      if (previousOpenCodeConfigRoot === undefined) {
        delete process.env.OPENCODE_CONFIG_ROOT;
      } else {
        process.env.OPENCODE_CONFIG_ROOT = previousOpenCodeConfigRoot;
      }

      await restoreFile(sessionStatePath, previousSessionState);
      await restoreFile(globalStatePath, previousGlobalState);
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
