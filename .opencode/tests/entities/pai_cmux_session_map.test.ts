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

  test("replaces stale lock and performs atomic write", async () => {
    const root = createTempRoot("cmux-lock-");
    const statePath = path.join(root, "opencode-hook-sessions.json");
    const lockPath = `${statePath}.lock`;

    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "stale", "utf-8");
    const staleSeconds = (Date.now() - 20_000) / 1000;
    fs.utimesSync(lockPath, staleSeconds, staleSeconds);

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
