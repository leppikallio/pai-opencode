import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const opencodeRoot = path.join(repoRoot, ".opencode");

describe("algorithm latest safety", () => {
  test("LATEST is safe and in allowlist", () => {
    const latestPath = path.join(opencodeRoot, "skills", "PAI", "Components", "Algorithm", "LATEST");
    const latest = readFileSync(latestPath, "utf8").trim();

    expect(latest).not.toBe("v3.5.0");

    const allowlist = new Set(["v0.2.34", "v3.5.0-opencode"]);
    expect(allowlist.has(latest)).toBe(true);
  });
});
