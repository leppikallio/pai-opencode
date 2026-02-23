import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { mergeSeedHooksIntoRuntimeSettings } from "../../tools/pai-install/merge-hooks";

function createRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "pai-install-merge-hooks-"));
  mkdirSync(path.join(root, "config"), { recursive: true });
  mkdirSync(path.join(root, "BACKUPS"), { recursive: true });
  return root;
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

describe("mergeSeedHooksIntoRuntimeSettings", () => {
  test("merges seed env/hooks, enforces env.PAI_DIR, rewrites commands, and creates backup", () => {
    const targetDir = createRoot();
    const sourceSeedPath = path.join(targetDir, "config", "claude-hooks.settings.json");
    const settingsPath = path.join(targetDir, "settings.json");

    writeJson(sourceSeedPath, {
      env: {
        PAI_DIR: "$" + "{PAI_DIR}",
        PROJECTS_DIR: "$" + "{PROJECTS_DIR}",
        FROM_SEED: "seed-value",
      },
      hooks: {
        SessionStart: [
          {
            hooks: [
                {
                  type: "command",
                  command: "$" + "{PAI_DIR}/hooks/session-start.hook.ts",
                },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "Task",
            hooks: [
                {
                  type: "command",
                  command: "bun $" + "{PAI_DIR}/hooks/task-post.hook.ts --quiet",
                },
            ],
          },
        ],
      },
    });

    writeJson(settingsPath, {
      env: {
        PAI_DIR: "/old/runtime/path",
        EXISTING_ENV: "runtime-value",
      },
      hooks: {
        SessionStart: [
          {
            hooks: [{ type: "command", command: "already-present-command" }],
          },
        ],
      },
      custom: { keep: true },
    });

    mergeSeedHooksIntoRuntimeSettings({ targetDir, sourceSeedPath });

    const merged = readJson(settingsPath);
    const env = merged.env as Record<string, string>;
    expect(env.PAI_DIR).toBe(targetDir);
    expect(env.EXISTING_ENV).toBe("runtime-value");
    expect(env.FROM_SEED).toBe("seed-value");
    expect(env.PROJECTS_DIR).toBe("$" + "{PROJECTS_DIR}");
    expect((merged.custom as Record<string, boolean>).keep).toBe(true);

    const sessionStart = ((merged.hooks as Record<string, unknown>).SessionStart as Array<{ hooks?: Array<{ command?: string }> }>);
    expect(sessionStart).toHaveLength(2);
    expect(sessionStart[1]?.hooks?.[0]?.command).toBe(`${targetDir}/hooks/session-start.hook.ts`);

    const postToolUse = ((merged.hooks as Record<string, unknown>).PostToolUse as Array<{ hooks?: Array<{ command?: string }> }>);
    expect(postToolUse[0]?.hooks?.[0]?.command).toBe(`bun ${targetDir}/hooks/task-post.hook.ts --quiet`);

    const backupFiles = readdirSync(path.join(targetDir, "BACKUPS")).filter((name) =>
      name.startsWith("settings.json.") && name.endsWith(".bak")
    );
    expect(backupFiles.length).toBe(1);

    const firstBackup = backupFiles[0];
    expect(firstBackup).toBeTruthy();
    const backup = readJson(path.join(targetDir, "BACKUPS", firstBackup as string));
    const backupEnv = backup.env as Record<string, string>;
    expect(backupEnv.PAI_DIR).toBe("/old/runtime/path");
  });

  test("is idempotent across repeated installs (no duplicate hook entries)", () => {
    const targetDir = createRoot();
    const sourceSeedPath = path.join(targetDir, "config", "claude-hooks.settings.json");
    const settingsPath = path.join(targetDir, "settings.json");

    writeJson(sourceSeedPath, {
      env: {
        PAI_DIR: "$" + "{PAI_DIR}",
      },
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "$" + "{PAI_DIR}/hooks/example.hook.ts" }],
          },
        ],
      },
    });

    writeJson(settingsPath, {
      env: {},
      hooks: {},
    });

    mergeSeedHooksIntoRuntimeSettings({ targetDir, sourceSeedPath });
    mergeSeedHooksIntoRuntimeSettings({ targetDir, sourceSeedPath });

    const merged = readJson(settingsPath);
    const preToolUse = ((merged.hooks as Record<string, unknown>).PreToolUse as Array<{ hooks?: Array<{ command?: string }> }>);
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse[0]?.hooks?.[0]?.command).toBe(`${targetDir}/hooks/example.hook.ts`);

    const backupFiles = readdirSync(path.join(targetDir, "BACKUPS")).filter((name) =>
      name.startsWith("settings.json.") && name.endsWith(".bak")
    );
    expect(backupFiles.length).toBe(1);
  });
});
