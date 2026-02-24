import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { mergeClaudeHooksSeedIntoSettingsJson } from "../../../Tools/pai-install/merge-claude-hooks";

function readJson(p: string) {
  return JSON.parse(readFileSync(p, "utf-8"));
}

describe("mergeClaudeHooksSeedIntoSettingsJson", () => {
  test("is idempotent (does not duplicate hook entries)", () => {
    const root = path.join(os.tmpdir(), `pai-install-${Date.now()}`);
    mkdirSync(path.join(root, "config"), { recursive: true });
    mkdirSync(path.join(root, "BACKUPS"), { recursive: true });

    const settingsPath = path.join(root, "settings.json");
    const seedPath = path.join(root, "config", "claude-hooks.settings.json");

    writeFileSync(settingsPath, JSON.stringify({ theme: "dark", hooks: {} }, null, 2));
    writeFileSync(
      seedPath,
      JSON.stringify(
        {
          env: { PAI_DIR: root },
          hooks: {
            PreToolUse: [
              { matcher: "Bash", hooks: [{ type: "command", command: `${root}/hooks/SecurityValidator.hook.ts` }] },
            ],
          },
        },
        null,
        2,
      ),
    );

    mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    const once = readJson(settingsPath);
    mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    const twice = readJson(settingsPath);

    expect(twice.theme).toBe("dark");
    expect(twice.hooks.PreToolUse.length).toBe(once.hooks.PreToolUse.length);
    expect(JSON.stringify(twice.hooks.PreToolUse)).toBe(JSON.stringify(once.hooks.PreToolUse));
  });
});
