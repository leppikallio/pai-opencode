import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

test("reflections sink docs parity in source-controlled memory docs", () => {
  const memorySystemDoc = path.join(repoRoot, ".opencode", "skills", "PAI", "SYSTEM", "MEMORYSYSTEM.md");
  const memoryReadmeDoc = path.join(repoRoot, ".opencode", "MEMORY", "README.md");

  const memorySystem = readFileSync(memorySystemDoc, "utf8");
  const memoryReadme = readFileSync(memoryReadmeDoc, "utf8");

  expect(memorySystem).toContain("LEARNING/REFLECTIONS");
  expect(memorySystem).toContain("algorithm-reflections.jsonl");
  expect(memorySystem).toContain("~/.config/opencode/MEMORY");

  expect(memoryReadme).toContain("LEARNING/REFLECTIONS");
  expect(memoryReadme).toContain("algorithm-reflections.jsonl");
  expect(memoryReadme).toContain("~/.config/opencode/MEMORY");
  expect(memoryReadme).toContain("installed runtime");
  expect(memoryReadme).toContain("source-controlled bootstrap documentation only");
  expect(memoryReadme).toContain("not the live runtime memory root");
  expect(memoryReadme).not.toContain("This directory is the runtime memory root for PAI/OpenCode.");
});
