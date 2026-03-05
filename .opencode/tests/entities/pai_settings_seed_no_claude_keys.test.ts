import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

describe("seed settings env", () => {
  test("does not include legacy CLAUDE_CODE_* keys", async () => {
    const settingsPath = fileURLToPath(new URL("../../settings.json", import.meta.url));
    const settings = await Bun.file(settingsPath).json() as { env?: Record<string, string> };

    const hasLegacyClaudeEnv = Object.keys(settings.env ?? {}).some((key) => key.startsWith("CLAUDE_CODE_"));
    expect(hasLegacyClaudeEnv).toBe(false);
  });
});
