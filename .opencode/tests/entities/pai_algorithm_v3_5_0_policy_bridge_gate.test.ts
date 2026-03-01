import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const opencodeRoot = path.join(repoRoot, ".opencode");

describe("algorithm v3.5.0 policy bridge gate", () => {
  test("v3.5.0-opencode.md contains policy bridge marker", () => {
    const algorithmPath = path.join(
      opencodeRoot,
      "skills",
      "PAI",
      "Components",
      "Algorithm",
      "v3.5.0-opencode.md",
    );

    expect(existsSync(algorithmPath)).toBe(true);

    const text = readFileSync(algorithmPath, "utf8");
    expect(text).toContain(
      "OPEN-CODE POLICY BRIDGE: todowrite is canonical ISC.json source.",
    );
  });
});
