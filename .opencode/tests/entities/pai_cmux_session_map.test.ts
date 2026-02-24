import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getDefaultCmuxSessionMapPath,
  lookupSessionMapping,
  upsertSessionMapping,
} from "../../plugins/pai-cc-hooks/shared/cmux-session-map";

function createTempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function writeLockFile(lockPath: string, ownerId: string, createdAt: number): void {
  fs.writeFileSync(lockPath, JSON.stringify({ ownerId, createdAt }) + "\n", "utf-8");
}

describe("cmux session map", () => {
  test("default path helper uses provided homeDir", () => {
    const homeDir = "/tmp/cmux-home";
    expect(getDefaultCmuxSessionMapPath({ homeDir })).toBe(
      path.join(homeDir, ".cmuxterm", "opencode-hook-sessions.json"),
    );
  });

  test("upsert + lookup by session_id", async () => {
    const root = createTempRoot("cmux-map-");
    const statePath = path.join(root, "opencode-hook-sessions.json");

    await upsertSessionMapping({
      statePath,
      sessionId: "ses_123",
      workspaceId: "workspace-uuid",
      surfaceId: "surface-uuid",
      cwd: "/tmp",
    });

    const found = await lookupSessionMapping({ statePath, sessionId: "ses_123" });
    expect(found?.surfaceId).toBe("surface-uuid");
  });

  test("upsert + lookup default to HOME-backed state path", async () => {
    const root = createTempRoot("cmux-home-");
    const originalHome = process.env.HOME;

    process.env.HOME = root;
    try {
      await upsertSessionMapping({
        sessionId: "ses_home",
        workspaceId: "workspace-home",
        surfaceId: "surface-home",
      });

      const found = await lookupSessionMapping({ sessionId: "ses_home" });
      expect(found?.surfaceId).toBe("surface-home");
      expect(fs.existsSync(getDefaultCmuxSessionMapPath())).toBe(true);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });

  test("stale lock eviction uses rename and performs atomic write", async () => {
    const root = createTempRoot("cmux-lock-");
    const statePath = path.join(root, "opencode-hook-sessions.json");
    const lockPath = `${statePath}.lock`;

    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    writeLockFile(lockPath, "stale-owner", Date.now() - 20_000);

    await upsertSessionMapping({
      statePath,
      sessionId: "ses_stale",
      workspaceId: "workspace-stale",
      surfaceId: "surface-stale",
    });

    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw) as { sessions?: Record<string, { surfaceId?: string }> };
    expect(parsed.sessions?.ses_stale?.surfaceId).toBe("surface-stale");
    expect(fs.existsSync(lockPath)).toBe(false);

    const staleArtifacts = fs
      .readdirSync(root)
      .filter((name) => name.startsWith("opencode-hook-sessions.json.lock.stale."));
    expect(staleArtifacts.length).toBe(1);
  });

  test("release does not delete lock when owner mismatches", async () => {
    const root = createTempRoot("cmux-owner-");
    const statePath = path.join(root, "opencode-hook-sessions.json");
    const lockPath = `${statePath}.lock`;

    const sessions: Record<string, unknown> = {};
    for (let idx = 0; idx < 10_000; idx += 1) {
      sessions[`seed_${idx}`] = {
        sessionId: `seed_${idx}`,
        workspaceId: `workspace_${idx}`,
        surfaceId: `surface_${idx}`,
        startedAt: idx,
        updatedAt: idx,
      };
    }
    fs.writeFileSync(statePath, JSON.stringify({ version: 1, sessions }, null, 2), "utf-8");

    let finished = false;
    const run = upsertSessionMapping({
      statePath,
      sessionId: "ses_owner",
      workspaceId: "workspace-owner",
      surfaceId: "surface-owner",
    }).finally(() => {
      finished = true;
    });

    const timeoutAt = Date.now() + 2_000;
    while (!fs.existsSync(lockPath)) {
      if (Date.now() >= timeoutAt) {
        throw new Error("Timed out waiting for lock acquisition");
      }
      await sleep(2);
    }

    while (!finished) {
      writeLockFile(lockPath, "intruder-owner", Date.now());
      await sleep(2);
    }

    await run;

    expect(fs.existsSync(lockPath)).toBe(true);
    fs.unlinkSync(lockPath);
  });

  test("non-stale lock is not evicted and acquire times out quickly", async () => {
    const root = createTempRoot("cmux-non-stale-");
    const statePath = path.join(root, "opencode-hook-sessions.json");
    const lockPath = `${statePath}.lock`;
    writeLockFile(lockPath, "live-owner", Date.now());

    const previousMaxWait = process.env.PAI_CMUX_SESSION_MAP_LOCK_MAX_WAIT_MS;
    process.env.PAI_CMUX_SESSION_MAP_LOCK_MAX_WAIT_MS = "60";
    try {
      await expect(
        upsertSessionMapping({
          statePath,
          sessionId: "ses_blocked",
          workspaceId: "workspace-blocked",
          surfaceId: "surface-blocked",
        }),
      ).rejects.toThrow("Failed to acquire cmux session map lock");
    } finally {
      if (previousMaxWait === undefined) {
        delete process.env.PAI_CMUX_SESSION_MAP_LOCK_MAX_WAIT_MS;
      } else {
        process.env.PAI_CMUX_SESSION_MAP_LOCK_MAX_WAIT_MS = previousMaxWait;
      }
    }

    expect(fs.existsSync(lockPath)).toBe(true);
    const staleArtifacts = fs
      .readdirSync(root)
      .filter((name) => name.startsWith("opencode-hook-sessions.json.lock.stale."));
    expect(staleArtifacts.length).toBe(0);
  });

  test("forced non-stale rename rolls lock back", async () => {
    const root = createTempRoot("cmux-rollback-");
    const statePath = path.join(root, "opencode-hook-sessions.json");
    const lockPath = `${statePath}.lock`;
    const originalCreatedAt = Date.now();
    writeLockFile(lockPath, "live-owner", originalCreatedAt);

    const previousMaxWait = process.env.PAI_CMUX_SESSION_MAP_LOCK_MAX_WAIT_MS;
    const previousForceRename = process.env.PAI_CMUX_SESSION_MAP_TEST_FORCE_RENAME_NON_STALE;
    process.env.PAI_CMUX_SESSION_MAP_LOCK_MAX_WAIT_MS = "60";
    process.env.PAI_CMUX_SESSION_MAP_TEST_FORCE_RENAME_NON_STALE = "1";

    try {
      await expect(
        upsertSessionMapping({
          statePath,
          sessionId: "ses_rollback",
          workspaceId: "workspace-rollback",
          surfaceId: "surface-rollback",
        }),
      ).rejects.toThrow("Failed to acquire cmux session map lock");
    } finally {
      if (previousMaxWait === undefined) {
        delete process.env.PAI_CMUX_SESSION_MAP_LOCK_MAX_WAIT_MS;
      } else {
        process.env.PAI_CMUX_SESSION_MAP_LOCK_MAX_WAIT_MS = previousMaxWait;
      }

      if (previousForceRename === undefined) {
        delete process.env.PAI_CMUX_SESSION_MAP_TEST_FORCE_RENAME_NON_STALE;
      } else {
        process.env.PAI_CMUX_SESSION_MAP_TEST_FORCE_RENAME_NON_STALE = previousForceRename;
      }
    }

    const lockRaw = fs.readFileSync(lockPath, "utf-8");
    const lock = JSON.parse(lockRaw) as { ownerId: string; createdAt: number };
    expect(lock.ownerId).toBe("live-owner");
    expect(lock.createdAt).toBe(originalCreatedAt);
  });

  test("concurrent upserts keep valid JSON and retain all sessions", async () => {
    const root = createTempRoot("cmux-concurrency-");
    const statePath = path.join(root, "opencode-hook-sessions.json");
    const count = 8;

    await Promise.all(
      Array.from({ length: count }, (_, idx) =>
        upsertSessionMapping({
          statePath,
          sessionId: `ses_${idx}`,
          workspaceId: `workspace_${idx}`,
          surfaceId: `surface_${idx}`,
        }),
      ),
    );

    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw) as { sessions: Record<string, unknown> };
    expect(Object.keys(parsed.sessions)).toHaveLength(count);
    for (let idx = 0; idx < count; idx += 1) {
      expect(parsed.sessions[`ses_${idx}`]).toBeDefined();
    }
  });
});
