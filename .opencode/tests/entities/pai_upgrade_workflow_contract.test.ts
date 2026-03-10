import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const opencodeRoot = path.join(repoRoot, ".opencode");
const skillRoot = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade");

const skillPath = path.join(skillRoot, "SKILL.md");
const templatesRoot = path.join(skillRoot, "Templates");
const templateSourcesV2Path = path.join(templatesRoot, "sources.v2.json");
const templateSourcesPath = path.join(templatesRoot, "sources.json");
const templateYouTubeChannelsPath = path.join(templatesRoot, "youtube-channels.json");
const legacySourcesV2Path = path.join(skillRoot, "sources.v2.json");
const legacySourcesPath = path.join(skillRoot, "sources.json");
const legacyYouTubeChannelsPath = path.join(skillRoot, "youtube-channels.json");
const monitorSourcesPath = path.join(skillRoot, "Tools", "MonitorSources.ts");
const workflowPaths = [
  path.join(skillRoot, "Workflows", "CheckForUpgrades.md"),
  path.join(skillRoot, "Workflows", "FindSources.md"),
  path.join(skillRoot, "Workflows", "ResearchUpgrade.md"),
  path.join(skillRoot, "Workflows", "AlgorithmUpgrade.md"),
];

function readAllDocs(): string[] {
  const files = [skillPath, ...workflowPaths];
  for (const filePath of files) {
    expect(existsSync(filePath)).toBe(true);
  }
  return files.map((filePath) => readFileSync(filePath, "utf8"));
}

function readWorkflowDocs(): string[] {
  for (const filePath of workflowPaths) {
    expect(existsSync(filePath)).toBe(true);
  }
  return workflowPaths.map((filePath) => readFileSync(filePath, "utf8"));
}

function readJson(filePath: string): unknown {
  expect(existsSync(filePath)).toBe(true);
  return JSON.parse(readFileSync(filePath, "utf8"));
}

describe("pai-upgrade workflow/doc contract", () => {
  test("monitor sources defaults are MEMORY-backed in runtime state tree", () => {
    expect(existsSync(monitorSourcesPath)).toBe(true);
    const monitorSource = readFileSync(monitorSourcesPath, "utf8");

    expect(monitorSource).toContain("PAI_UPGRADE_MEMORY_ROOT");
    expect(monitorSource).toContain("PAI_UPGRADE_CONFIG_DIR");
    expect(monitorSource).toContain("PAI_UPGRADE_STATE_DIR");
    expect(monitorSource).toContain("MEMORY");
    expect(monitorSource).toContain("STATE");
    expect(monitorSource).toContain("pai-upgrade");
  });

  test("skill identity is PAI upgrade intelligence", () => {
    const skill = readFileSync(skillPath, "utf8");

    expect(/pai upgrade intelligence/i.test(skill)).toBe(true);
  });

  test("repo surface keeps monitored-source templates blank and template-only", () => {
    const sourcesV2Template = readJson(templateSourcesV2Path);
    const sourcesTemplate = readJson(templateSourcesPath);
    const youtubeTemplate = readJson(templateYouTubeChannelsPath);

    expect(sourcesV2Template).toEqual({
      schema_version: 2,
      sources: [],
    });
    expect(sourcesTemplate).toEqual({
      blogs: [],
      github_repos: [],
      changelogs: [],
      documentation: [],
      community: [],
    });
    expect(youtubeTemplate).toEqual({
      schema_version: 1,
      channels: [],
    });

    expect(existsSync(legacySourcesV2Path)).toBe(false);
    expect(existsSync(legacySourcesPath)).toBe(false);
    expect(existsSync(legacyYouTubeChannelsPath)).toBe(false);
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

  test("operator docs point to MEMORY-backed config/state and template bootstrap artifacts", () => {
    const combined = readAllDocs().join("\n");

    const required = [
      "~/.config/opencode/MEMORY/STATE/pai-upgrade/config/",
      "~/.config/opencode/MEMORY/STATE/pai-upgrade/state/",
      "Templates/sources.v2.json",
      "Templates/sources.json",
      "Templates/youtube-channels.json",
    ];

    for (const phrase of required) {
      expect(combined).toContain(phrase);
    }

    expect(/blank\s+templates?/i.test(combined)).toBe(true);
    expect(/bootstrap\s+artifacts?/i.test(combined)).toBe(true);
  });

  test("workflow docs resolve template refs from Workflows via ../Templates paths", () => {
    const workflowDocs = readWorkflowDocs();
    const templateFiles = ["sources.v2.json", "sources.json", "youtube-channels.json"];

    for (const doc of workflowDocs) {
      for (const templateFile of templateFiles) {
        const relativeRef = `../Templates/${templateFile}`;
        expect(doc).toContain(relativeRef);

        const linesWithTemplateRef = doc
          .split("\n")
          .filter((line) => line.includes(`Templates/${templateFile}`));

        for (const line of linesWithTemplateRef) {
          expect(line.includes(relativeRef)).toBe(true);
        }
      }
    }
  });

  test("operator docs keep monitored-source catalogs single-homed in MEMORY", () => {
    const combined = readAllDocs().join("\n");

    expect(combined).not.toContain("~/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/pai-upgrade/");
    expect(/source catalogs and channel lists/i.test(combined)).toBe(false);
    expect(/LoadSkillConfig\s+inputs/i.test(combined)).toBe(false);
  });

  test("docs keep migration behavior one-time and not permanent tooling behavior", () => {
    const combined = readAllDocs().join("\n");

    expect(/one-time\s+local\s+migration/i.test(combined)).toBe(true);
    expect(/permanent\s+(?:install|runtime)\s+tooling/i.test(combined)).toBe(false);
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
      "MEMORY/STATE/pai-upgrade/config/youtube-channels.json",
      "MEMORY/STATE/pai-upgrade/state/youtube-videos.json",
      "MEMORY/STATE/pai-upgrade/state/transcripts/youtube/",
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
      expect(/monitor|runtime|state|catalog|source|template|bootstrap/i.test(line)).toBe(true);
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
