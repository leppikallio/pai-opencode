import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const opencodeRoot = path.join(repoRoot, ".opencode");

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

describe("PAI SKILL markdown drift gate", () => {
  test("SKILL.md contains top 16 lines of latest algorithm markdown", () => {
    const algorithmDir = path.join(opencodeRoot, "skills", "PAI", "Components", "Algorithm");
    const latest = readFileSync(path.join(algorithmDir, "LATEST"), "utf8").trim();
    const algorithmPath = path.join(algorithmDir, `${latest}.md`);
    const skillPath = path.join(opencodeRoot, "skills", "PAI", "SKILL.md");

    const algorithmText = normalizeNewlines(readFileSync(algorithmPath, "utf8"));
    const skillText = normalizeNewlines(readFileSync(skillPath, "utf8"));
    const top16 = algorithmText.split("\n").slice(0, 16).join("\n");

    expect(skillText.includes(top16)).toBe(true);
  });
});
