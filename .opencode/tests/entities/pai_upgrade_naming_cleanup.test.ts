import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const opencodeRoot = path.join(repoRoot, ".opencode");

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];

  const files: string[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function inScopeFiles(): string[] {
  const skillFiles = listFiles(path.join(opencodeRoot, "skills", "utilities", "pai-upgrade"));
  const entityTests = listFiles(path.join(opencodeRoot, "tests", "entities"))
    .filter((filePath) => path.basename(filePath).includes("pai_upgrade"));
  const fixtures = listFiles(path.join(opencodeRoot, "tests", "fixtures", "pai-upgrade"));
  const planFiles = listFiles(path.join(repoRoot, "docs", "plans"))
    .filter((filePath) => path.basename(filePath).includes("pai-upgrade"));

  return [...skillFiles, ...entityTests, ...fixtures, ...planFiles];
}

function toPattern(parts: string[], flags = "i"): RegExp {
  return new RegExp(parts.join(""), flags);
}

function proseFiles(): string[] {
  return inScopeFiles().filter((filePath) => {
    const ext = path.extname(filePath);
    return ext === ".md" || ext === ".ts";
  });
}

function markdownFiles(): string[] {
  return inScopeFiles().filter((filePath) => path.extname(filePath) === ".md");
}

describe("pai-upgrade strict naming cleanup", () => {
  test("scope contains no references to the legacy provider wrapper path", () => {
    const legacyToolFile = ["Anthro", "pic", ".ts"].join("");
    const legacyToolPath = ["Tools", legacyToolFile].join("/");

    for (const filePath of inScopeFiles()) {
      const content = readFileSync(filePath, "utf8");
      expect(content.includes(legacyToolPath)).toBe(false);
    }
  });

  test("docs/plans avoid anthropic-as-architecture naming", () => {
    const disallowed = [
      toPattern(["anthropic", "\\/claude provider sources"]),
      toPattern(["anthropic", "\\/claude product\\/blog sources"]),
      toPattern(["anthropic and claude sources are included"]),
    ];

    for (const filePath of markdownFiles()) {
      const content = readFileSync(filePath, "utf8");
      for (const pattern of disallowed) {
        expect(pattern.test(content)).toBe(false);
      }
    }
  });

  test("docs/tests/plans avoid provider-branded inference architecture phrasing", () => {
    const anthropicBased = ["anthropic", "-based"].join("");
    const paiOpenCode = ["pai", "-opencode"].join("");
    const disallowed = [
      new RegExp(`${anthropicBased}\\s+(?:inference|architecture|identity|skill|system)`, "i"),
      new RegExp(`${paiOpenCode}[^\\n]{0,80}${anthropicBased}`, "i"),
    ];

    for (const filePath of proseFiles()) {
      const content = readFileSync(filePath, "utf8");
      for (const pattern of disallowed) {
        expect(pattern.test(content)).toBe(false);
      }
    }
  });

  test("anthropic references remain source/provider/filter scoped", () => {
    const anthropicLines = markdownFiles()
      .flatMap((filePath) => readFileSync(filePath, "utf8").split("\n"));

    for (const line of anthropicLines) {
      if (!/anthropic/i.test(line)) continue;

      expect(/provider|source|filter|catalog|feed|monitor|fallback/i.test(line)).toBe(true);
      expect(toPattern(["architectural\\s+identity|", "anthropic", "-based\\s+inference"]).test(line)).toBe(false);
    }
  });
});
