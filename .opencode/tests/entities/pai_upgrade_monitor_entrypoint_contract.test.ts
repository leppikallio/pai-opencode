import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const opencodeRoot = path.join(repoRoot, ".opencode");
const docsPlansRoot = path.join(repoRoot, "docs", "plans");

function patternFrom(parts: string[], flags = "i"): RegExp {
  return new RegExp(parts.join(""), flags);
}

const legacyEntrypointFilenamePattern = patternFrom(["anthropic", "\\.ts"]);
const legacyEntrypointRelativePattern = patternFrom(["tools", "\\/", "anthropic", "\\.ts"]);
const legacyEntrypointSymbolPattern = patternFrom(["run", "anthropic", "cli"]);
const legacyEntrypointTitlePattern = patternFrom(["anthropic", " changes monitor"]);

const monitorEntrypointPath = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade", "Tools", "MonitorSources.ts");
const monitorToolsRoot = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade", "Tools");
const skillPath = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade", "SKILL.md");
const checkForUpgradesPath = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade", "Workflows", "CheckForUpgrades.md");
const findSourcesPath = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade", "Workflows", "FindSources.md");
const researchUpgradePath = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade", "Workflows", "ResearchUpgrade.md");
const algorithmUpgradePath = path.join(opencodeRoot, "skills", "utilities", "pai-upgrade", "Workflows", "AlgorithmUpgrade.md");
const task4IsolationNotePath = path.join(repoRoot, "docs", "plans", "20260308-task4-pai-upgrade-isolation.md");
const task5IsolationNotePath = path.join(repoRoot, "docs", "plans", "20260308-task5-pai-upgrade-isolation.md");

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];

  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const next = queue.pop();
    if (!next) continue;

    const entries = readdirSync(next, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(next, entry.name);
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
  const entityTests = listFiles(path.join(opencodeRoot, "tests", "entities")).filter((filePath) => path.basename(filePath).includes("pai_upgrade"));
  const fixtures = listFiles(path.join(opencodeRoot, "tests", "fixtures", "pai-upgrade"));
  const planFiles = listFiles(docsPlansRoot).filter((filePath) => path.basename(filePath).includes("pai-upgrade"));
  return [...skillFiles, ...entityTests, ...fixtures, ...planFiles];
}

describe("pai-upgrade monitor entrypoint contract", () => {
  test("legacy wrapper references are removed and wrapper file is deleted", () => {
    const toolFiles = listFiles(monitorToolsRoot).map((filePath) => path.basename(filePath));
    expect(toolFiles.some((fileName) => legacyEntrypointFilenamePattern.test(fileName))).toBe(false);

    for (const filePath of inScopeFiles()) {
      const content = readFileSync(filePath, "utf8");
      expect(legacyEntrypointRelativePattern.test(content)).toBe(false);
      expect(legacyEntrypointSymbolPattern.test(content)).toBe(false);
      expect(legacyEntrypointTitlePattern.test(content)).toBe(false);
    }
  });

  test("MonitorSources help/examples stay provider-neutral", () => {
    const monitorEntrypoint = readFileSync(monitorEntrypointPath, "utf8");

    expect(monitorEntrypoint).toContain("--provider <id>");
    expect(monitorEntrypoint).not.toContain("--provider anthropic");
    expect(/anthropic\/claude/i.test(monitorEntrypoint)).toBe(false);
  });

  test("anthropic remains provider/filter value, not architectural entrypoint identity", () => {
    const contents = inScopeFiles().map((filePath) => readFileSync(filePath, "utf8"));
    const combined = contents.join("\n");

    expect(combined.includes("anthropic")).toBe(true);
    expect(legacyEntrypointRelativePattern.test(combined)).toBe(false);
    expect(legacyEntrypointSymbolPattern.test(combined)).toBe(false);
  });

  test("MonitorSources.ts is the only canonical monitoring entrypoint", () => {
    expect(existsSync(monitorEntrypointPath)).toBe(true);

    const skill = readFileSync(skillPath, "utf8");
    const checkForUpgrades = readFileSync(checkForUpgradesPath, "utf8");

    expect(skill).toContain("Tools/MonitorSources.ts");
    expect(checkForUpgrades).toContain("Tools/MonitorSources.ts");
  });

  test("operator docs route live config/state to MEMORY paths, not skill-root runtime files", () => {
    const docs = [
      readFileSync(skillPath, "utf8"),
      readFileSync(checkForUpgradesPath, "utf8"),
      readFileSync(findSourcesPath, "utf8"),
      readFileSync(researchUpgradePath, "utf8"),
      readFileSync(algorithmUpgradePath, "utf8"),
    ].join("\n");

    expect(docs).toContain("~/.config/opencode/MEMORY/STATE/pai-upgrade/config/");
    expect(docs).toContain("~/.config/opencode/MEMORY/STATE/pai-upgrade/state/");

    const forbidden = [
      "~/.config/opencode/skills/utilities/pai-upgrade/sources.v2.json",
      "~/.config/opencode/skills/utilities/pai-upgrade/sources.json",
      "~/.config/opencode/skills/utilities/pai-upgrade/youtube-channels.json",
      "~/.config/opencode/skills/utilities/pai-upgrade/State/",
    ];

    for (const phrase of forbidden) {
      expect(docs.includes(phrase)).toBe(false);
    }
  });

  test("task4 scope remains monitor-only and does not reference synthesis execution", () => {
    if (!existsSync(task4IsolationNotePath)) {
      return;
    }

    const isolationNote = readFileSync(task4IsolationNotePath, "utf8").toLowerCase();
    expect(isolationNote.includes("does **not** introduce synthesis orchestration")).toBe(true);

    const task4Files = [
      readFileSync(monitorEntrypointPath, "utf8"),
      readFileSync(skillPath, "utf8"),
      readFileSync(checkForUpgradesPath, "utf8"),
      isolationNote,
    ].join("\n").toLowerCase();

    expect(task4Files.includes("buildupgradesynthesis")).toBe(false);
    expect(task4Files.includes("runupgradesynthesis")).toBe(false);
    expect(task4Files.includes("synthesizeupgrade")).toBe(false);
  });

  test("task5 scope is synthesis-only inside MonitorSources without second public entrypoint", () => {
    if (!existsSync(task5IsolationNotePath)) {
      return;
    }

    const isolationNote = readFileSync(task5IsolationNotePath, "utf8").toLowerCase();
    expect(isolationNote.includes("task 5 is limited")).toBe(true);
    expect(isolationNote.includes("tools/monitorsources.ts")).toBe(true);
    expect(isolationNote.includes("pai_upgrade_synthesis_contract.test.ts")).toBe(true);
    expect(isolationNote.includes("does **not** introduce a second public synthesis entrypoint")).toBe(true);

    const publicEntrypointSurface = [
      readFileSync(skillPath, "utf8"),
      readFileSync(checkForUpgradesPath, "utf8"),
    ].join("\n").toLowerCase();

    expect(publicEntrypointSurface.includes("tools/monitorsources.ts")).toBe(true);
    expect(publicEntrypointSurface.includes("tools/synthesize")).toBe(false);
    expect(publicEntrypointSurface.includes("runupgradesynthesis")).toBe(false);
    expect(publicEntrypointSurface.includes("buildupgradesynthesis")).toBe(false);
    expect(publicEntrypointSurface.includes("synthesizeupgrade")).toBe(false);
    expect(publicEntrypointSurface.includes("step 5: mine bounded internal reflections")).toBe(false);
    expect(publicEntrypointSurface.includes("minealgorithmreflections.ts")).toBe(false);
    expect(publicEntrypointSurface.includes("## internal reflections")).toBe(false);
  });
});
