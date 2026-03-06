import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

describe("Algorithm reflections write contract", () => {
  test("generated SKILL and source algorithm include mkdir+append reflections command", () => {
    const opencodeRoot = path.join(repoRoot, ".opencode");
    const algorithmDir = path.join(opencodeRoot, "skills", "PAI", "Components", "Algorithm");
    const latestVersion = readFileSync(path.join(algorithmDir, "LATEST"), "utf8").trim();
    const algorithmPath = path.join(algorithmDir, `${latestVersion}.md`);
    const skillPath = path.join(opencodeRoot, "skills", "PAI", "SKILL.md");

    const expectedPath = "~/.config/opencode/MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl";
    const expectedShellShape = /mkdir -p ~\/\.config\/opencode\/MEMORY\/LEARNING\/REFLECTIONS\s*&&\s*echo/;

    const algorithmText = readFileSync(algorithmPath, "utf8");
    const skillText = readFileSync(skillPath, "utf8");

    expect(algorithmText).toContain(expectedPath);
    expect(algorithmText).toMatch(expectedShellShape);

    expect(skillText).toContain(expectedPath);
    expect(skillText).toMatch(expectedShellShape);
  });
});
