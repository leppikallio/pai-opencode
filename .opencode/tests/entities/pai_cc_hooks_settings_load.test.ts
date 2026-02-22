import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import { loadClaudeHookSettings } from "../../plugins/pai-cc-hooks/claude/config";

describe("loadClaudeHookSettings", () => {
  test("loads SessionStart and SessionEnd hook config entries", async () => {
    const settingsPath = fileURLToPath(new URL("../../config/claude-hooks.settings.json", import.meta.url));

    const settings = await loadClaudeHookSettings(settingsPath);

    expect(settings.hooks?.SessionStart?.length).toBeGreaterThan(0);
    expect(settings.hooks?.SessionEnd?.length).toBeGreaterThan(0);
  });
});
