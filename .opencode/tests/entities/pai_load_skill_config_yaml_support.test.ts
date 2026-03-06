import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadSkillConfig } from "../../skills/PAI/Tools/LoadSkillConfig";

function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
  const previous: Record<string, string | undefined> = {};

  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function withTempDir(prefix: string, run: (root: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("loadSkillConfig YAML support", () => {
  test("loads YAML base config and YAML customization with deep merge", () => {
    withTempDir("pai-load-skill-config-yaml-", (root) => {
      const paiDir = path.join(root, "runtime");
      const skillDir = path.join(paiDir, "skills", "utilities", "pai-upgrade");
      const customizationDir = path.join(
        paiDir,
        "skills",
        "PAI",
        "USER",
        "SKILLCUSTOMIZATIONS",
        "pai-upgrade",
      );

      mkdirSync(skillDir, { recursive: true });
      mkdirSync(customizationDir, { recursive: true });

      writeFileSync(
        path.join(skillDir, "sources.yaml"),
        [
          "sources:",
          "  - id: base-source",
          "    url: https://example.com/base",
          "metadata:",
          "  enabled: true",
        ].join("\n"),
        "utf8",
      );

      writeFileSync(
        path.join(customizationDir, "EXTEND.yaml"),
        [
          "skill: pai-upgrade",
          "extends:",
          "  - sources.yaml",
          "merge_strategy: deep_merge",
          "enabled: true",
        ].join("\n"),
        "utf8",
      );

      writeFileSync(
        path.join(customizationDir, "sources.yaml"),
        [
          "_customization:",
          "  merge_strategy: deep_merge",
          "sources:",
          "  - id: custom-source",
          "    url: https://example.com/custom",
          "metadata:",
          "  owner: custom",
        ].join("\n"),
        "utf8",
      );

      withEnv({ PAI_DIR: paiDir }, () => {
        const config = loadSkillConfig<{
          sources: Array<{ id: string; url: string }>;
          metadata: Record<string, unknown>;
        }>(skillDir, "sources.yaml");

        expect(config.sources).toEqual([
          { id: "base-source", url: "https://example.com/base" },
          { id: "custom-source", url: "https://example.com/custom" },
        ]);
        expect(config.metadata).toEqual({ enabled: true, owner: "custom" });
      });
    });
  });
});
