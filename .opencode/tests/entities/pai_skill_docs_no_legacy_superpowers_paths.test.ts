import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const skillsRoot = path.join(repoRoot, ".opencode", "skills");

function listSkillDocs(root: string): string[] {
  const out: string[] = [];
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();
    if (!dir) continue;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        out.push(full);
      }
    }
  }

  return out.sort((a, b) => a.localeCompare(b));
}

test("SKILL.md docs do not contain legacy ~/.config/superpowers references", () => {
  const offenders = listSkillDocs(skillsRoot)
    .filter((filePath) => readFileSync(filePath, "utf8").includes(".config/superpowers"))
    .map((filePath) => path.relative(repoRoot, filePath));

  const message = offenders.length
    ? `Legacy superpowers path references found:\n${offenders.join("\n")}`
    : "no offenders";

  expect(offenders, message).toEqual([]);
});
