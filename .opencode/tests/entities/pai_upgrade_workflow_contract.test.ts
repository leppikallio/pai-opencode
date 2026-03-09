import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const opencodeRoot = path.join(repoRoot, ".opencode");
const skillRoot = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade");

const skillPath = path.join(skillRoot, "SKILL.md");
const workflowPaths = [
  path.join(skillRoot, "Workflows", "CheckForUpgrades.md"),
  path.join(skillRoot, "Workflows", "FindSources.md"),
  path.join(skillRoot, "Workflows", "ResearchUpgrade.md"),
  path.join(skillRoot, "Workflows", "ReleaseNotesDeepDive.md"),
  path.join(skillRoot, "Workflows", "MineReflections.md"),
  path.join(skillRoot, "Workflows", "AlgorithmUpgrade.md"),
];

function readAllDocs(): string[] {
  const files = [skillPath, ...workflowPaths];
  for (const filePath of files) {
    expect(existsSync(filePath)).toBe(true);
  }
  return files.map((filePath) => readFileSync(filePath, "utf8"));
}

describe("pai-upgrade workflow/doc contract", () => {
  test("skill identity is PAI upgrade intelligence", () => {
    const skill = readFileSync(skillPath, "utf8");

    expect(/pai upgrade intelligence/i.test(skill)).toBe(true);
  });

  test("anthropic references stay scoped to provider/source context", () => {
    const docs = readAllDocs();
    const anthropicLines = docs
      .flatMap((doc) => doc.split("\n"))
      .filter((line) => /anthropic/i.test(line));

    expect(anthropicLines.length).toBeGreaterThan(0);
    for (const line of anthropicLines) {
      expect(/provider|source|feed|filter|catalog|monitor|scope/i.test(line)).toBe(true);
      expect(/identity|brand|persona|entrypoint/i.test(line)).toBe(false);
    }
  });

  test("workflow docs state canonical output shape", () => {
    const docs = readAllDocs();
    for (const doc of docs) {
      expect(doc).toContain("Discoveries → Recommendations → Implementation Targets");
    }
  });

  test("workflow docs assert internal learnings may outrank external discoveries", () => {
    const combined = readAllDocs().join("\n");
    expect(/internal learnings? may outrank external discoveries/i.test(combined)).toBe(true);
  });

  test("workflow docs avoid promising unsupported output sections", () => {
    const combined = readAllDocs().join("\n");

    const forbidden = [
      "## High Priority",
      "## Medium Priority",
      "## Low Priority",
      "## New Videos",
      "owners and timeline",
    ];

    for (const phrase of forbidden) {
      expect(combined.includes(phrase)).toBe(false);
    }
  });

  test("operator-facing entrypoint references point to MonitorSources.ts", () => {
    const docs = readAllDocs();
    const referencedTools = new Set<string>();

    const toolPattern = /skills\/utilities\/pai-upgrade\/Tools\/([A-Za-z0-9]+\.ts)/g;
    for (const doc of docs) {
      for (const match of doc.matchAll(toolPattern)) {
        referencedTools.add(match[1]);
      }
    }

    expect(referencedTools.size).toBeGreaterThan(0);
    expect(referencedTools.has("MonitorSources.ts")).toBe(true);
    expect([...referencedTools]).toEqual(["MonitorSources.ts"]);
  });

  test("workflow docs scope YouTube references to monitored-source runtime context", () => {
    const combined = readAllDocs().join("\n");

    const required = [
      "youtube-channels.json",
      "State/youtube-videos.json",
      "State/transcripts/youtube/",
      "Tools/MonitorSources.ts",
    ];

    for (const phrase of required) {
      expect(combined).toContain(phrase);
    }

    const youtubeLines = combined
      .split("\n")
      .filter((line) => /youtube/i.test(line));

    expect(youtubeLines.length).toBeGreaterThan(0);
    for (const line of youtubeLines) {
      expect(/monitor|runtime|state|catalog|source/i.test(line)).toBe(true);
    }

    const forbidden = [
      "Check YouTube",
      "run the YouTube workflow",
    ];

    for (const phrase of forbidden) {
      expect(combined).not.toContain(phrase);
    }

    const transcriptToolLines = combined
      .split("\n")
      .filter((line) => /use a transcript tool/i.test(line));

    for (const line of transcriptToolLines) {
      expect(line).toContain("MonitorSources.ts");
    }
  });
});
