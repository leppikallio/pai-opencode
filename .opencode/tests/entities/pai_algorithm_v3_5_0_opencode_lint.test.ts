import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const opencodeRoot = path.join(repoRoot, ".opencode");

describe("algorithm v3.5.0 opencode binding lint", () => {
  test("requires v3.5.0-opencode algorithm source file", () => {
    const algorithmPath = path.join(
      opencodeRoot,
      "skills",
      "PAI",
      "Components",
      "Algorithm",
      "v3.5.0-opencode.md",
    );

    expect(existsSync(algorithmPath)).toBe(true);
  });
});
