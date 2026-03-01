import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const opencodeRoot = path.join(repoRoot, ".opencode");

describe("PRDFORMAT opencode lint", () => {
  test("PRDFORMAT.md exists and references only opencode paths", () => {
    const prdFormatPath = path.join(opencodeRoot, "PAISYSTEM", "PRDFORMAT.md");

    expect(existsSync(prdFormatPath)).toBe(true);

    const content = readFileSync(prdFormatPath, "utf8");

    expect(content.includes("~/.claude")).toBe(false);
    expect(content.includes("work.json")).toBe(false);
    expect(content.includes("PRDSync")).toBe(false);
    expect(content.includes("~/.config/opencode")).toBe(true);
    expect(content.includes("MEMORY/STATE/current-work.json")).toBe(true);
  });
});
