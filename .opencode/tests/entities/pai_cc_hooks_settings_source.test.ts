import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadClaudeHookSettings } from "../../plugins/pai-cc-hooks/claude/config";

function createConfigRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "pai-cc-hooks-"));
  mkdirSync(path.join(root, "config"), { recursive: true });
  return root;
}

function writeFallbackSettings(root: string): void {
  writeFileSync(
    path.join(root, "config", "claude-hooks.settings.json"),
    JSON.stringify(
      {
        env: { PAI_DIR: "$" + "{PAI_DIR}", LEGACY_ONLY: "seed" },
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "legacy-submit" }] }],
          Stop: [{ hooks: [{ type: "command", command: "legacy-stop" }] }],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function withConfigRoot<T>(root: string, run: () => Promise<T>): Promise<T> {
  const previousRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;
  process.env.PAI_CC_HOOKS_CONFIG_ROOT = root;

  try {
    return await run();
  } finally {
    if (previousRoot === undefined) {
      delete process.env.PAI_CC_HOOKS_CONFIG_ROOT;
    } else {
      process.env.PAI_CC_HOOKS_CONFIG_ROOT = previousRoot;
    }
  }
}

describe("hook settings source", () => {
  test("loads hooks/env only from <opencodeRoot>/settings.json (ignores legacy config file)", async () => {
    const root = createConfigRoot();
    writeFallbackSettings(root);

    // Runtime settings.json is the active source.
    writeFileSync(
      path.join(root, "settings.json"),
      JSON.stringify(
        {
          env: { PAI_DIR: root },
          hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "x" }] }] },
        },
        null,
        2,
      ),
      "utf8",
    );

    await withConfigRoot(root, async () => {
      const loaded = await loadClaudeHookSettings();
      expect(loaded.env.PAI_DIR).toBe(root);
      expect(loaded.env.LEGACY_ONLY).toBeUndefined();
      expect(loaded.hooks?.UserPromptSubmit?.length).toBe(1);
      expect(loaded.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toBe("x");
      expect(loaded.hooks?.Stop).toBeUndefined();
    });
  });

  test("does not load legacy hooks/env when <opencodeRoot>/settings.json is empty JSON", async () => {
    const root = createConfigRoot();
    writeFallbackSettings(root);
    writeFileSync(path.join(root, "settings.json"), "{}", "utf8");

    await withConfigRoot(root, async () => {
      const loaded = await loadClaudeHookSettings();
      expect(loaded.env.PAI_DIR).toBe(root);
      expect(loaded.env.LEGACY_ONLY).toBeUndefined();
      expect(loaded.hooks).toBeNull();
    });
  });

  test("does not load legacy hooks/env when <opencodeRoot>/settings.json is malformed JSON", async () => {
    const root = createConfigRoot();
    writeFallbackSettings(root);
    writeFileSync(path.join(root, "settings.json"), "{", "utf8");

    await withConfigRoot(root, async () => {
      const loaded = await loadClaudeHookSettings();
      expect(loaded.env.PAI_DIR).toBe(root);
      expect(loaded.env.LEGACY_ONLY).toBeUndefined();
      expect(loaded.hooks).toBeNull();
    });
  });
});
