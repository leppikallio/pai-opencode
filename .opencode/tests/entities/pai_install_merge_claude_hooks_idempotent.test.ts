import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { mergeClaudeHooksSeedIntoSettingsJson } from "../../../Tools/pai-install/merge-claude-hooks";

function createRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "pai-install-"));
  mkdirSync(path.join(root, "BACKUPS"), { recursive: true });
  return root;
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
}

describe("mergeClaudeHooksSeedIntoSettingsJson", () => {
  test("is idempotent and rewrites only PAI_DIR placeholders", () => {
    const root = createRoot();
    const settingsPath = path.join(root, "settings.json");
    const seedPath = path.join(root, "seed-settings.json");
    const paiDirPlaceholder = "$" + "{PAI_DIR}";
    const paiDirPrefix = `${paiDirPlaceholder}/`;

    writeFileSync(settingsPath, JSON.stringify({ theme: "dark", hooks: {} }, null, 2));
    writeFileSync(
      seedPath,
      JSON.stringify(
        {
          env: { PAI_DIR: paiDirPlaceholder },
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  {
                    type: "command",
                    command: `bun ${paiDirPrefix}hooks/SecurityValidator.hook.ts --dir ${paiDirPlaceholder}`,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    const first = mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    const once = readJson(settingsPath);
    const second = mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    const twice = readJson(settingsPath);

    expect(twice.theme).toBe("dark");
    expect(twice.hooks).toEqual(once.hooks);
    expect(first.backupPath).not.toBeNull();
    expect(existsSync(first.backupPath as string)).toBe(true);
    expect(second.backupPath).toBeNull();

    const preToolUse = (twice.hooks as Record<string, unknown>).PreToolUse as Array<{
      hooks?: Array<{ command?: string }>;
    }>;
    expect(preToolUse.length).toBe(1);
    expect(preToolUse[0]?.hooks?.[0]?.command).toBe(
      `bun ${root}/hooks/SecurityValidator.hook.ts --dir ${paiDirPlaceholder}`,
    );
  });

  test("throws when source seed file is missing", () => {
    const root = createRoot();
    const settingsPath = path.join(root, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark", hooks: {} }, null, 2));

    const missingSeedPath = path.join(root, "missing-seed.settings.json");
    expect(() => {
      mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: missingSeedPath });
    }).toThrow(`Claude hooks seed file not found: ${missingSeedPath}`);
  });

  test("reports null backupPath when settings file did not exist", () => {
    const root = createRoot();
    const seedPath = path.join(root, "seed-settings.json");
    const paiDirPlaceholder = "$" + "{PAI_DIR}";
    const paiDirPrefix = `${paiDirPlaceholder}/`;

    writeFileSync(
      seedPath,
      JSON.stringify(
        {
          env: { PAI_DIR: paiDirPlaceholder },
          hooks: {
            PreToolUse: [
              { matcher: "Bash", hooks: [{ type: "command", command: `${paiDirPrefix}hooks/new.hook.ts` }] },
            ],
          },
        },
        null,
        2,
      ),
    );

    const result = mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeNull();
  });
});
