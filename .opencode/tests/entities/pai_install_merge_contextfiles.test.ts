import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { mergeClaudeHooksSeedIntoSettingsJson } from "../../../Tools/pai-install/merge-claude-hooks";

const PAI_CONTEXT_FILES = [
  "skills/PAI/SYSTEM/AISTEERINGRULES.md",
  "skills/PAI/USER/AISTEERINGRULES.md",
  "skills/PAI/USER/DAIDENTITY.md",
] as const;

function createRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "pai-install-contextfiles-"));
  mkdirSync(path.join(root, "BACKUPS"), { recursive: true });
  return root;
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function normalizeContextFileKey(entry: string): string {
  return entry.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

describe("mergeClaudeHooksSeedIntoSettingsJson contextFiles merge", () => {
  test("replaces runtime CORE-only contextFiles and preserves provider/env/hooks behavior", () => {
    const root = createRoot();
    const settingsPath = path.join(root, "settings.json");
    const seedPath = path.join(root, "seed-settings.json");
    const runtimeProvider = {
      id: "openai",
      model: "openai/gpt-5.3-codex",
      baseURL: "https://api.openai.com/v1",
      options: { reasoningEffort: "high" },
    };

    writeJson(settingsPath, {
      contextFiles: ["skills/CORE/SKILL.md", "skills/CORE/SYSTEM/AISTEERINGRULES.md"],
      provider: runtimeProvider,
      env: { RUNTIME_ONLY: "1", SHARED: "runtime" },
      hooks: { Runtime: [{ sentinel: "runtime-hook" }] },
    });

    writeJson(seedPath, {
      contextFiles: [...PAI_CONTEXT_FILES],
      env: { SHARED: "seed", SEED_ONLY: "1", PAI_DIR: "$" + "{PAI_DIR}" },
      hooks: {
        Seed: [
          {
            sentinel: "seed-hook",
            command: `bun ${"$" + "{PAI_DIR}"}/hooks/seed.ts`,
          },
        ],
      },
    });

    mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    const merged = readJson(settingsPath);
    const normalizedRoot = root.replace(/\\/g, "/");

    expect(merged.contextFiles).toEqual(PAI_CONTEXT_FILES);
    expect(merged.provider).toEqual(runtimeProvider);
    expect(merged.env).toEqual({
      RUNTIME_ONLY: "1",
      SHARED: "seed",
      SEED_ONLY: "1",
      PAI_DIR: root,
    });
    expect(merged.hooks).toEqual({
      Seed: [
        {
          sentinel: "seed-hook",
          command: `bun ${normalizedRoot}/hooks/seed.ts`,
        },
      ],
    });
  });

  test("uses seed contextFiles when runtime settings omits contextFiles", () => {
    const root = createRoot();
    const settingsPath = path.join(root, "settings.json");
    const seedPath = path.join(root, "seed-settings.json");
    const runtimeProvider = {
      id: "openai",
      model: "openai/gpt-5.3-codex",
      baseURL: "https://api.openai.com/v1",
      options: { reasoningEffort: "medium" },
    };

    writeJson(settingsPath, {
      provider: runtimeProvider,
      env: { RUNTIME_ONLY: "1" },
      hooks: { Runtime: [] },
    });

    writeJson(seedPath, {
      contextFiles: [...PAI_CONTEXT_FILES],
      env: { PAI_DIR: "$" + "{PAI_DIR}" },
      hooks: { Seed: [] },
    });

    mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    const merged = readJson(settingsPath);

    expect(merged.contextFiles).toEqual(PAI_CONTEXT_FILES);
    expect(merged.provider).toEqual(runtimeProvider);
  });

  test("uses seed contextFiles when runtime settings has empty contextFiles array", () => {
    const root = createRoot();
    const settingsPath = path.join(root, "settings.json");
    const seedPath = path.join(root, "seed-settings.json");
    const runtimeProvider = {
      id: "openai",
      model: "openai/gpt-5.3-codex",
      baseURL: "https://api.openai.com/v1",
      options: { reasoningEffort: "low" },
    };

    writeJson(settingsPath, {
      contextFiles: [],
      provider: runtimeProvider,
      env: { RUNTIME_ONLY: "1" },
      hooks: { Runtime: [] },
    });

    writeJson(seedPath, {
      contextFiles: [...PAI_CONTEXT_FILES],
      env: { PAI_DIR: "$" + "{PAI_DIR}" },
      hooks: { Seed: [] },
    });

    mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    const merged = readJson(settingsPath);

    expect(merged.contextFiles).toEqual(PAI_CONTEXT_FILES);
    expect(merged.provider).toEqual(runtimeProvider);
  });

  test("uses seed contextFiles when runtime contextFiles is pruned to empty", () => {
    const root = createRoot();
    const settingsPath = path.join(root, "settings.json");
    const seedPath = path.join(root, "seed-settings.json");

    writeJson(settingsPath, {
      contextFiles: ["skills/PAI/SKILL.md"],
      provider: { id: "openai", model: "openai/gpt-5.3-codex" },
      env: { RUNTIME_ONLY: "1" },
      hooks: { Runtime: [] },
    });

    writeJson(seedPath, {
      contextFiles: [...PAI_CONTEXT_FILES],
      env: { PAI_DIR: "$" + "{PAI_DIR}" },
      hooks: { Seed: [] },
    });

    mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    const merged = readJson(settingsPath);

    expect(merged.contextFiles).toEqual(PAI_CONTEXT_FILES);
  });

  test("prunes deprecated runtime skills/PAI/SKILL.md when no CORE entries exist", () => {
    const root = createRoot();
    const settingsPath = path.join(root, "settings.json");
    const seedPath = path.join(root, "seed-settings.json");
    const runtimeContextFiles = ["skills/PAI/SKILL.md", "custom/context.md"];

    writeJson(settingsPath, {
      contextFiles: runtimeContextFiles,
      provider: { id: "openai", model: "openai/gpt-5.3-codex" },
      env: { RUNTIME_ONLY: "1" },
      hooks: { Runtime: [] },
    });

    writeJson(seedPath, {
      contextFiles: [...PAI_CONTEXT_FILES],
      env: { PAI_DIR: "$" + "{PAI_DIR}" },
      hooks: { Seed: [] },
    });

    mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    const merged = readJson(settingsPath);

    expect(merged.contextFiles).toEqual(["custom/context.md"]);
  });

  test("conservatively repairs mixed CORE entries while preserving custom runtime entries", () => {
    const root = createRoot();
    const settingsPath = path.join(root, "settings.json");
    const seedPath = path.join(root, "seed-settings.json");

    writeJson(settingsPath, {
      contextFiles: [
        "  .\\skills\\CORE\\SKILL.md  ",
        "docs/custom-notes.md",
        "skills/PAI/USER/AISTEERINGRULES.md",
        "./skills/CORE/LEGACY.md",
      ],
      env: { RUNTIME_ONLY: "1" },
      hooks: { Runtime: [] },
    });

    writeJson(seedPath, {
      contextFiles: [...PAI_CONTEXT_FILES],
      env: { PAI_DIR: "$" + "{PAI_DIR}" },
      hooks: { Seed: [] },
    });

    mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    const merged = readJson(settingsPath);
    const contextFiles = merged.contextFiles as string[];

    expect(contextFiles).toEqual([
      "docs/custom-notes.md",
      "skills/PAI/USER/AISTEERINGRULES.md",
      "skills/PAI/SYSTEM/AISTEERINGRULES.md",
      "skills/PAI/USER/DAIDENTITY.md",
    ]);

    for (const entry of contextFiles) {
      expect(normalizeContextFileKey(entry).startsWith("skills/core/")).toBe(false);
    }

    expect(contextFiles.includes("docs/custom-notes.md")).toBe(true);
  });

  test("is idempotent after conservative contextFiles repair", () => {
    const root = createRoot();
    const settingsPath = path.join(root, "settings.json");
    const seedPath = path.join(root, "seed-settings.json");

    writeJson(settingsPath, {
      contextFiles: ["skills/CORE/SKILL.md", "custom/context.md"],
      provider: { id: "openai", model: "openai/gpt-5.3-codex" },
      env: { RUNTIME_ONLY: "1" },
      hooks: { Runtime: [] },
    });

    writeJson(seedPath, {
      contextFiles: [...PAI_CONTEXT_FILES],
      env: { PAI_DIR: "$" + "{PAI_DIR}" },
      hooks: { Seed: [] },
    });

    const first = mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    const onceBytes = readFileSync(settingsPath, "utf8");
    const second = mergeClaudeHooksSeedIntoSettingsJson({ targetDir: root, sourceSeedPath: seedPath });
    const twiceBytes = readFileSync(settingsPath, "utf8");

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(twiceBytes).toBe(onceBytes);
  });
});
