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

    expect(content.trim().length).toBeGreaterThan(200);

    expect(content.includes("~/.claude")).toBe(false);
    expect(content.includes(".claude/")).toBe(false);
    expect(content.includes("STATE/work.json")).toBe(false);
    expect(content.includes("/work.json")).toBe(false);
    expect(content.includes("PRDSync")).toBe(false);
    expect(content.includes("~/.config/opencode")).toBe(true);
    expect(content.includes("MEMORY/STATE/current-work.json")).toBe(true);

    // The PRD format should explicitly mention how PRDs are generated today.
    expect(content.includes(".opencode/plugins/lib/prd-template.ts")).toBe(true);

    // Minimal structure requirements (avoid accidentally committing a stub).
    expect(content).toMatch(/^#\s+/m);
    expect(content).toMatch(/^##\s+/m);
    expect(content).toMatch(/\bPRD\b/i);
    expect(content).toMatch(/\bISC\b|Ideal State Criteria/i);
  });
});
