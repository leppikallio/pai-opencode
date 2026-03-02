#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import { emitMdWithFrontmatter, parseMdWithFrontmatter } from "./lib/nwave/markdown";
import { guessNwaveRoot } from "./lib/nwave/paths";
import { rewriteText } from "./lib/nwave/rewrite";

const INTERACTIVE_SECTION_MARKER = "## Interactive Decision Points";
const ASK_USER_QUESTION_MARKER = "AskUserQuestion";
const INTERACTION_PREAMBLE = [
  "## Interaction Mode Requirements",
  "- Use PAI Brainstorming Mode while collecting decision answers.",
  "- Use the `question` tool for one decision per turn.",
  "- After decisions are captured, proceed in FULL mode.",
].join("\n");

type Options = {
  nwaveRoot: string;
  opencodeRoot: string;
  dryRun: boolean;
  clean: boolean;
};

type RewriteContext = {
  nwaveRepoRoot: string;
  desPythonpath: string;
};

type PlannedCommand = {
  sourcePath: string;
  outputPath: string;
  sourceContent: string;
  injectInteractionPreamble: boolean;
};

type PlannedAgent = {
  sourcePath: string;
  outputPath: string;
  sourceContent: string;
};

type PlannedMirrorFile = {
  sourcePath: string;
  outputPath: string;
  rewrite: boolean;
};

type ToolMap = Record<string, true>;

const AGENT_TOOL_KEYS = ["read", "write", "edit", "bash", "grep", "glob", "task"];
const SKILL_NAME = "nwave";
const OPTIONAL_NWAVE_FILES = ["framework-catalog.yaml", "VERSION"];

function usage(): void {
  const defaultOpencodeRoot = path.resolve(process.cwd(), ".opencode");
  const defaultNwaveRoot = guessNwaveRoot();

  console.log("Usage: bun Tools/GenerateNWave.ts [options]");
  console.log("");
  console.log("Options:");
  console.log(
    `  --nwave-root <dir>    Upstream nWave root (default: ${defaultNwaveRoot ?? "<auto>"})`
  );
  console.log(`  --opencode-root <dir> OpenCode root (default: ${defaultOpencodeRoot})`);
  console.log("  --dry-run             Validate and print plan only");
  console.log("  --clean               Remove existing generated outputs first");
  console.log("  -h, --help            Show help");
}

function parseArgs(argv: string[]): Options | null {
  let nwaveRoot = guessNwaveRoot() ?? "";
  let opencodeRoot = path.resolve(process.cwd(), ".opencode");
  let dryRun = false;
  let clean = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      return null;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--clean") {
      clean = true;
      continue;
    }

    if (arg === "--nwave-root") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --nwave-root");
      }
      nwaveRoot = path.resolve(value);
      i++;
      continue;
    }

    if (arg === "--opencode-root") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --opencode-root");
      }
      opencodeRoot = path.resolve(value);
      i++;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!nwaveRoot) {
    throw new Error(
      "Unable to auto-detect --nwave-root. Pass --nwave-root explicitly, or set NWAVE_ROOT/NWAVE_REPO_ROOT."
    );
  }

  return {
    nwaveRoot: path.resolve(nwaveRoot),
    opencodeRoot,
    dryRun,
    clean,
  };
}

function isDirectory(dirPath: string): boolean {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function validateNwaveRoot(nwaveRoot: string): void {
  if (!fs.existsSync(nwaveRoot)) {
    throw new Error(`--nwave-root does not exist: ${nwaveRoot}`);
  }

  if (!isDirectory(nwaveRoot)) {
    throw new Error(`--nwave-root is not a directory: ${nwaveRoot}`);
  }

  const requiredDirectories = [
    "agents",
    path.join("tasks", "nw"),
    "skills",
    "data",
    "templates",
  ];
  const missing: string[] = [];

  for (const rel of requiredDirectories) {
    const absolutePath = path.join(nwaveRoot, rel);
    if (!isDirectory(absolutePath)) {
      missing.push(rel.replace(/\\/g, "/"));
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `--nwave-root is missing required directories: ${missing.join(", ")} (root: ${nwaveRoot})`
    );
  }
}

function plannedOutputDirectories(opencodeRoot: string): string[] {
  const skillRoot = path.join(opencodeRoot, "skills", SKILL_NAME);
  const mirrorRoot = path.join(skillRoot, "nWave");

  return [
    path.join(opencodeRoot, "commands", "nw"),
    path.join(opencodeRoot, "agents"),
    skillRoot,
    path.join(skillRoot, "Tools"),
    path.join(skillRoot, "Workflows"),
    mirrorRoot,
    path.join(mirrorRoot, "skills"),
    path.join(mirrorRoot, "data"),
    path.join(mirrorRoot, "templates"),
  ];
}

function listMarkdownFiles(dirPath: string): string[] {
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function listFilesRecursive(dirPath: string): string[] {
  const files: string[] = [];

  function walk(currentPath: string, relativePrefix: string): void {
    const entries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const sourcePath = path.join(currentPath, entry.name);
      const relativePath = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name;

      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "__pycache__" || entry.name === "node_modules") {
          continue;
        }
        walk(sourcePath, relativePath);
        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  walk(dirPath, "");
  return files;
}

function shouldInjectInteractionPreamble(input: string): boolean {
  return input.includes(INTERACTIVE_SECTION_MARKER) || input.includes(ASK_USER_QUESTION_MARKER);
}

function prependInteractionPreamble(body: string): string {
  const withoutLeadingNewlines = body.replace(/^\n+/, "");
  return `${INTERACTION_PREAMBLE}\n\n${withoutLeadingNewlines}`;
}

function substituteRewriteContext(input: string, ctx: RewriteContext): string {
  return input
    .split("{DES_PYTHONPATH}")
    .join(ctx.desPythonpath)
    .split("{NWAVE_REPO_ROOT}")
    .join(ctx.nwaveRepoRoot);
}

function buildCommandsPlan(nwaveRoot: string, opencodeRoot: string): PlannedCommand[] {
  const sourceDir = path.join(nwaveRoot, "tasks", "nw");
  const outputDir = path.join(opencodeRoot, "commands", "nw");

  return listMarkdownFiles(sourceDir).map((fileName) => {
    const sourcePath = path.join(sourceDir, fileName);
    const sourceContent = fs.readFileSync(sourcePath, "utf8");

    return {
      sourcePath,
      outputPath: path.join(outputDir, fileName),
      sourceContent,
      injectInteractionPreamble: shouldInjectInteractionPreamble(sourceContent),
    };
  });
}

function listNWaveAgentFiles(dirPath: string): string[] {
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^nw-.*\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function buildAgentsPlan(nwaveRoot: string, opencodeRoot: string): PlannedAgent[] {
  const sourceDir = path.join(nwaveRoot, "agents");
  const outputDir = path.join(opencodeRoot, "agents");

  return listNWaveAgentFiles(sourceDir).map((fileName) => {
    const sourcePath = path.join(sourceDir, fileName);
    const sourceContent = fs.readFileSync(sourcePath, "utf8");

    return {
      sourcePath,
      outputPath: path.join(outputDir, fileName),
      sourceContent,
    };
  });
}

function shouldRewriteMirrorFile(args: { rel: string; dirKind: "skills" | "data" | "templates" }): boolean {
  const lower = args.rel.toLowerCase();
  if (lower.endsWith("/skill.md") || lower.endsWith("\\skill.md")) return false;
  if (!lower.includes(".")) return false;

  if (args.dirKind === "templates") {
    return lower.endsWith(".md") || lower.endsWith(".yaml") || lower.endsWith(".yml");
  }
  if (args.dirKind === "skills" || args.dirKind === "data") {
    return lower.endsWith(".md");
  }
  return false;
}

function buildMirrorPlan(nwaveRoot: string, opencodeRoot: string): PlannedMirrorFile[] {
  const skillRoot = path.join(opencodeRoot, "skills", SKILL_NAME);
  const mirrorRoot = path.join(skillRoot, "nWave");

  const planned: PlannedMirrorFile[] = [];
  const areas: Array<{ dir: string; kind: "skills" | "data" | "templates" }> = [
    { dir: "skills", kind: "skills" },
    { dir: "data", kind: "data" },
    { dir: "templates", kind: "templates" },
  ];

  for (const area of areas) {
    const sourceDir = path.join(nwaveRoot, area.dir);
    for (const rel of listFilesRecursive(sourceDir)) {
      const relPosix = rel.replace(/\\/g, "/");
      if (relPosix.split("/").some((seg) => seg === "SKILL.md")) {
        continue;
      }

      planned.push({
        sourcePath: path.join(sourceDir, rel),
        outputPath: path.join(mirrorRoot, area.dir, rel),
        rewrite: shouldRewriteMirrorFile({ rel: relPosix, dirKind: area.kind }),
      });
    }
  }

  for (const opt of OPTIONAL_NWAVE_FILES) {
    const src = path.join(nwaveRoot, opt);
    if (!isDirectory(path.dirname(src)) || !fs.existsSync(src) || !fs.statSync(src).isFile()) {
      continue;
    }
    planned.push({
      sourcePath: src,
      outputPath: path.join(mirrorRoot, opt),
      rewrite: false,
    });
  }

  return planned.sort((a, b) => a.outputPath.localeCompare(b.outputPath));
}

function ensureDir(dirPath: string, dryRun: boolean) {
  if (dryRun) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function removePath(targetPath: string, dryRun: boolean) {
  if (dryRun) return;
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function removeNwaveAgentOutputs(args: { agentsDir: string; dryRun: boolean }) {
  if (!isDirectory(args.agentsDir)) return;
  const entries = fs.readdirSync(args.agentsDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!/^nw-.*\.md$/i.test(ent.name)) continue;
    removePath(path.join(args.agentsDir, ent.name), args.dryRun);
  }
}

function cleanGeneratedOutputs(args: { opencodeRoot: string; dryRun: boolean }) {
  removePath(path.join(args.opencodeRoot, "commands", "nw"), args.dryRun);
  removeNwaveAgentOutputs({ agentsDir: path.join(args.opencodeRoot, "agents"), dryRun: args.dryRun });
  removePath(path.join(args.opencodeRoot, "skills", SKILL_NAME), args.dryRun);
}

function mapAgentTools(tools: unknown): ToolMap {
  const out: ToolMap = {};
  if (!Array.isArray(tools)) return out;

  for (const item of tools) {
    if (typeof item !== "string") continue;
    const key = item.trim().toLowerCase();
    if (AGENT_TOOL_KEYS.includes(key)) {
      out[key] = true;
    }
  }

  return out;
}

function mapAgentModel(model: unknown): { model?: string; options?: Record<string, unknown> } {
  if (typeof model !== "string" || !model.trim()) return {};
  const lower = model.trim().toLowerCase();

  if (lower === "inherit") {
    return {};
  }

  if (lower === "haiku") {
    return { model: "openai/gpt-5.3-codex-spark" };
  }

  if (lower === "sonnet") {
    return {
      model: "openai/gpt-5.2",
      options: {
        reasoningEffort: "high",
        textVerbosity: "medium",
      },
    };
  }

  if (lower === "opus") {
    return {
      model: "openai/gpt-5.2",
      options: {
        reasoningEffort: "xhigh",
        textVerbosity: "high",
      },
    };
  }

  return { model: model.trim() };
}

function writeTextFile(filePath: string, content: string, dryRun: boolean) {
  if (dryRun) return;
  ensureDir(path.dirname(filePath), dryRun);
  fs.writeFileSync(filePath, content, "utf8");
}

function writeBinaryFile(filePath: string, content: Buffer, dryRun: boolean) {
  if (dryRun) return;
  ensureDir(path.dirname(filePath), dryRun);
  fs.writeFileSync(filePath, content);
}

function buildSkillRouterMarkdown(ctx: RewriteContext): string {
  return `---
name: nwave
description: nWave methodology (generated mirror)
---

# nWave

This skill is generated at install time from an upstream nWave checkout.

## Runtime paths

- Skills mirror: \`~/.config/opencode/skills/nwave/nWave/\`
- Commands: \`/nw/<command>\`
- Agents: \`~/.config/opencode/agents/nw-*.md\`

## Python runtime (DES)

nWave’s DES CLI is expected to run via Poetry from the upstream repo:

- \`NWAVE_REPO_ROOT\`: ${ctx.nwaveRepoRoot}
- \`DES_PYTHONPATH\`: ${ctx.desPythonpath}

Prereq: run \`poetry -C <nwave-repo> install\` at least once. \`<nwave-repo>\` is the parent directory of the \`--nwave-root\` you installed from.
`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    usage();
    process.exit(0);
  }

  validateNwaveRoot(options.nwaveRoot);

  const nwaveRepoRoot = path.resolve(path.join(options.nwaveRoot, ".."));
  const desPythonpath = path.join(nwaveRepoRoot, "src");
  const ctx: RewriteContext = {
    nwaveRepoRoot,
    desPythonpath,
  };

  const outputDirs = plannedOutputDirectories(options.opencodeRoot);
  const commandsPlan = buildCommandsPlan(options.nwaveRoot, options.opencodeRoot);
  const agentsPlan = buildAgentsPlan(options.nwaveRoot, options.opencodeRoot);
  const mirrorPlan = buildMirrorPlan(options.nwaveRoot, options.opencodeRoot);

  console.log("nWave generation plan");
  console.log(`nwave-root: ${options.nwaveRoot}`);
  console.log(`opencode-root: ${options.opencodeRoot}`);
  console.log(`NWAVE_REPO_ROOT: ${ctx.nwaveRepoRoot}`);
  console.log(`DES_PYTHONPATH: ${ctx.desPythonpath}`);
  console.log(`clean: ${options.clean}`);

  console.log("planned-output-directories:");
  for (const d of outputDirs) {
    console.log(`- ${d}`);
  }

  console.log("planned-command-outputs:");
  for (const cmd of commandsPlan) {
    console.log(`- ${cmd.outputPath}${cmd.injectInteractionPreamble ? " [interactive-preamble]" : ""}`);
  }

  console.log("planned-agent-outputs:");
  for (const agent of agentsPlan) {
    console.log(`- ${agent.outputPath}`);
  }

  console.log("planned-nwave-skill-mirror:");
  for (const item of mirrorPlan) {
    console.log(`- ${item.outputPath}${item.rewrite ? " [rewrite]" : ""}`);
  }

  if (options.dryRun) {
    return;
  }

  if (options.clean) {
    cleanGeneratedOutputs({ opencodeRoot: options.opencodeRoot, dryRun: false });
  }

  for (const d of outputDirs) {
    ensureDir(d, false);
  }

  // Generate command templates
  for (const cmd of commandsPlan) {
    const parsed = parseMdWithFrontmatter(cmd.sourceContent);
    const rawDescription = parsed.data.description;
    const description = typeof rawDescription === "string" ? rewriteText(rawDescription) : "";
    const data = description ? { description } : {};

    let body = substituteRewriteContext(rewriteText(parsed.body), ctx);
    if (cmd.injectInteractionPreamble) {
      body = prependInteractionPreamble(body);
    }

    const out = emitMdWithFrontmatter({ data, body });
    writeTextFile(cmd.outputPath, out, false);
  }

  // Generate agents
  for (const agent of agentsPlan) {
    const parsed = parseMdWithFrontmatter(agent.sourceContent);
    const rawDescription = parsed.data.description;
    const description = typeof rawDescription === "string" ? rewriteText(rawDescription) : "";

    const mappedModel = mapAgentModel(parsed.data.model);
    const tools = mapAgentTools(parsed.data.tools);

    const data: Record<string, unknown> = {
      description,
      mode: "subagent",
    };

    if (mappedModel.model) {
      data.model = mappedModel.model;
    }
    if (mappedModel.options && Object.keys(mappedModel.options).length > 0) {
      data.options = mappedModel.options;
    }
    if (Object.keys(tools).length > 0) {
      data.tools = tools;
    }

    const body = substituteRewriteContext(rewriteText(parsed.body), ctx);
    const out = emitMdWithFrontmatter({ data, body });
    writeTextFile(agent.outputPath, out, false);
  }

  // Generate skill router
  const skillRoot = path.join(options.opencodeRoot, "skills", SKILL_NAME);
  writeTextFile(path.join(skillRoot, "SKILL.md"), buildSkillRouterMarkdown(ctx), false);
  ensureDir(path.join(skillRoot, "Tools"), false);
  ensureDir(path.join(skillRoot, "Workflows"), false);

  // Mirror upstream nWave content
  for (const item of mirrorPlan) {
    if (item.rewrite) {
      const raw = fs.readFileSync(item.sourcePath, "utf8");
      const rewritten = substituteRewriteContext(rewriteText(raw), ctx);
      writeTextFile(item.outputPath, rewritten, false);
      continue;
    }

    const buf = fs.readFileSync(item.sourcePath);
    writeBinaryFile(item.outputPath, buf, false);
  }

  console.log(`generated-command-count: ${commandsPlan.length}`);
  console.log(`generated-agent-count: ${agentsPlan.length}`);
  console.log(`generated-nwave-mirror-file-count: ${mirrorPlan.length}`);
}

try {
  main();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`GenerateNWave: ${msg}`);
  process.exit(1);
}
