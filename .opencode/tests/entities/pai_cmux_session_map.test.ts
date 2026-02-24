import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { lookupSessionMapping, upsertSessionMapping } from "../../plugins/pai-cc-hooks/shared/cmux-session-map";

describe("cmux session map", () => {
  test("upsert + lookup by session_id", async () => {
    const root = path.join(os.tmpdir(), `cmux-map-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
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
});
