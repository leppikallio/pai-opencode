import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const opencodeRoot = path.join(repoRoot, ".opencode");

const skillPath = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade", "SKILL.md");
const checkForUpgradesPath = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade", "Workflows", "CheckForUpgrades.md");
const mineReflectionsPath = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade", "Workflows", "MineReflections.md");
const algorithmUpgradePath = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade", "Workflows", "AlgorithmUpgrade.md");
const loadSkillConfigPath = path.join(opencodeRoot, "skills", "PAI", "Tools", "LoadSkillConfig.ts");

describe("pai-upgrade reflections workflow parity", () => {
  test("required reflection workflows exist", () => {
    expect(existsSync(mineReflectionsPath)).toBe(true);
    expect(existsSync(algorithmUpgradePath)).toBe(true);
  });

  test("skill routes to reflection workflows", () => {
    const skill = readFileSync(skillPath, "utf8");

    expect(skill).toContain("**MineReflections**");
    expect(skill).toContain("<Workflows/MineReflections.md>");
    expect(skill).toContain("**AlgorithmUpgrade**");
    expect(skill).toContain("<Workflows/AlgorithmUpgrade.md>");
  });

  test("check workflow includes internal reflections references", () => {
    const checkForUpgrades = readFileSync(checkForUpgradesPath, "utf8");

    expect(checkForUpgrades).toContain("algorithm-reflections.jsonl");
    expect(checkForUpgrades).toContain("Internal Reflections");
  });

  test("check workflow documents default days behavior and config fallback path", () => {
    const checkForUpgrades = readFileSync(checkForUpgradesPath, "utf8");

    expect(checkForUpgrades).toContain("default example value `14`");
    expect(checkForUpgrades).toContain("bun ~/.config/opencode/skills/PAI/Tools/LoadSkillConfig.ts ~/.config/opencode/skills/utilities/pai-upgrade sources.json");
  });

  test("workflow docs avoid legacy or machine-specific paths", () => {
    const docs = [
      readFileSync(skillPath, "utf8"),
      readFileSync(checkForUpgradesPath, "utf8"),
      readFileSync(mineReflectionsPath, "utf8"),
      readFileSync(algorithmUpgradePath, "utf8"),
    ];

    const forbiddenLiterals = [
      ".claude/",
      "~/.claude/",
      "/Users/zuul/.config/opencode/skills/pai-upgrade",
    ];

    const forbiddenPatterns = [
      /\/Users\/[^/]+\/\.config\/opencode\//,
      /\/home\/[^/]+\/\.config\/opencode\//,
    ];

    for (const doc of docs) {
      for (const banned of forbiddenLiterals) {
        expect(doc.includes(banned)).toBe(false);
      }

      for (const banned of forbiddenPatterns) {
        expect(banned.test(doc)).toBe(false);
      }
    }
  });

  test("LoadSkillConfig help examples use utilities/pai-upgrade path", () => {
    const loadSkillConfig = readFileSync(loadSkillConfigPath, "utf8");

    expect(loadSkillConfig).not.toContain("~/.config/opencode/skills/pai-upgrade");
    expect(loadSkillConfig).toContain("~/.config/opencode/skills/utilities/pai-upgrade");
  });
});
