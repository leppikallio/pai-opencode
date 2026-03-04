#!/usr/bin/env bun

/**
 * CreateDynamicCore.ts - Assembles SKILL.md from Components/
 *
 * OpenCode adaptation:
 * - Writes into the *source repo* (.opencode/skills/PAI), not runtime
 * - Reads identity variables from ~/.config/opencode/settings.json if present
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME || "";

// Source skill directory (this repo)
const CORE_DIR = join(import.meta.dir, "..");
const COMPONENTS_DIR = join(CORE_DIR, "Components");
const ALGORITHM_DIR = join(COMPONENTS_DIR, "Algorithm");
const OUTPUT_FILE = join(CORE_DIR, "SKILL.md");

// Runtime settings (optional)
const SETTINGS_PATH = HOME
  ? join(HOME, ".config", "opencode", "settings.json")
  : "";

function getTimestamp(): string {
  const now = new Date();
  const day = now.getDate();
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  const hour = now.getHours().toString().padStart(2, "0");
  const minute = now.getMinutes().toString().padStart(2, "0");
  const second = now.getSeconds().toString().padStart(2, "0");
  return `${day} ${month} ${year} ${hour}:${minute}:${second}`;
}

function loadVariables(): Record<string, string> {
  if (!SETTINGS_PATH || !existsSync(SETTINGS_PATH)) {
    return {
      "{DAIDENTITY.NAME}": "PAI",
      "{DAIDENTITY.FULLNAME}": "Personal AI",
      "{DAIDENTITY.DISPLAYNAME}": "PAI",
      "{PRINCIPAL.NAME}": "User",
      "{PRINCIPAL.TIMEZONE}": "UTC",
    };
  }

  try {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    return {
      "{DAIDENTITY.NAME}": settings.daidentity?.name || "PAI",
      "{DAIDENTITY.FULLNAME}": settings.daidentity?.fullName || "Personal AI",
      "{DAIDENTITY.DISPLAYNAME}": settings.daidentity?.displayName || "PAI",
      "{PRINCIPAL.NAME}": settings.principal?.name || "User",
      "{PRINCIPAL.TIMEZONE}": settings.principal?.timezone || "UTC",
    };
  } catch {
    return {
      "{DAIDENTITY.NAME}": "PAI",
      "{DAIDENTITY.FULLNAME}": "Personal AI",
      "{DAIDENTITY.DISPLAYNAME}": "PAI",
      "{PRINCIPAL.NAME}": "User",
      "{PRINCIPAL.TIMEZONE}": "UTC",
    };
  }
}

function resolveVariables(content: string, variables: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(variables)) {
    // Avoid String.prototype.replaceAll for older TS lib targets
    result = result.split(key).join(value);
  }
  return result;
}

function replaceAll(input: string, search: string, replacement: string): string {
  return input.split(search).join(replacement);
}

function replaceSection(
  input: string,
  startMarker: string,
  endMarker: string,
  replacementBody: string
): string {
  const start = input.indexOf(startMarker);
  const end = input.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) return input;

  return (
    input.slice(0, start) +
    replacementBody +
    input.slice(end)
  );
}

function assertAlgorithmAdapted(algorithm: string): void {
  const forbidden = [
    "http://localhost:8888/notify",
    "~/.claude/",
    "PRDSync.hook.ts",
    "`Skill` tool",
    "`Task` tool",
    "Skill tool",
    "Skill(\"",
    "Task(\"",
    "AskUser tool",
    "Entry banner was already printed by CLAUDE.md",
    "Execution Modes section of CLAUDE.md",
    "via the Skill tool",
    "via the Task tool",
  ];

  const hits = forbidden.filter((s) => algorithm.includes(s));
  if (hits.length > 0) {
    throw new Error(
      `Algorithm adaptation incomplete; found forbidden strings: ${hits.join(", ")}`
    );
  }
}

function adaptAlgorithmForOpenCode(raw: string): string {
  let out = raw;

  // Claude-specific phrasing.
  out = replaceAll(
    out,
    "**Entry banner was already printed by CLAUDE.md** before this file was loaded. The user has already seen:",
    "**Console output at Algorithm entry (MANDATORY):**"
  );
  out = replaceAll(
    out,
    "Execution Modes section of CLAUDE.md",
    "Execution Modes section of OPENCODE.md"
  );

  // Tool binding mechanical replacements.
  out = replaceAll(out, "`Skill` tool", "`skill` tool");
  out = replaceAll(out, "via the Skill tool", "via the `skill` tool");
  out = replaceAll(out, "`Task` tool", "`task` tool");
  out = replaceAll(out, "via the Task tool", "via the `task` tool");
  out = replaceAll(out, "AskUser tool", "`question` tool");

  // Common casing/inline call sites.
  out = replaceAll(out, "Skill tool", "`skill` tool");
  out = out.replace(/\bSkill\("/g, 'skill("');
  out = out.replace(/\bTask\("/g, 'task("');

  // Path replacements.
  out = replaceAll(out, "~/.claude/PAI/PRDFORMAT.md", "~/.config/opencode/PAISYSTEM/PRDFORMAT.md");

  // Hook references: OpenCode persists criteria via todowrite today.
  out = out.replace(
    /\*\*What hooks do \(read-only from PRD\):\*\*[\s\S]*?\n\n/,
    "**Hooks and persistence (OpenCode binding):** In OpenCode today, `todowrite` persists criteria to `ISC.json` under the current work directory. PRD checkboxes are informational unless an explicit bridge is implemented.\n\n"
  );

  // Voice announcements: replace curl ritual with voice_notify tool binding.
  out = replaceSection(
    out,
    "### Voice Announcements",
    "### PRD as System of Record",
    [
      "### Voice Announcements (OpenCode)",
      "",
      "At Algorithm entry and every phase transition, announce via the `voice_notify` tool (main session only).",
      "These are direct, synchronous tool calls. Do not send to background.",
      "",
      "**Algorithm entry:** message `\"Entering the Algorithm\"` — immediately before OBSERVE begins.",
      "**Phase transitions:** message `\"Entering the PHASE_NAME phase.\"` — as the first action at each phase, before the PRD edit.",
      "",
      "**CRITICAL: Only the primary agent may call `voice_notify`.** Background agents, subagents, and teammates spawned via the `task` tool must NEVER call voice.",
      "",
      "### PRD as System of Record",
    ].join("\n")
  );

  // Execution section voice line.
  out = out.replace(
    /\*\*Voice\s*\(FIRST action after loading this file\):\*\*.*\n/,
    "**Voice (FIRST action after loading this file):** Call `voice_notify` with message `\"Entering the Algorithm\"`.\n"
  );

  out = out.replace(
    /\*\*Voice:\*\*[\s\S]*?\n\n/,
    "**Voice:** Use `voice_notify` with message `\"Entering the Algorithm\"`.\n\n"
  );

  // Text nits.
  out = replaceAll(out, "voice curl", "voice notification");

  // Observe section: OpenCode PRD location instructions.
  out = out.replace(
    /- IDEAL STATE Criteria Generation — write criteria directly into the PRD:[\s\S]*?OUTPUT:/,
    [
      "- IDEAL STATE Criteria Generation — write criteria directly into the PRD:",
      "- Resolve the current work directory from `~/.config/opencode/MEMORY/STATE/current-work.json`",
      "- Write `PRD-YYYYMMDD-<slug>.md` with Write/Edit tools (slug format: `YYYYMMDD-HHMMSS_kebab-task-description`) per `~/.config/opencode/PAISYSTEM/PRDFORMAT.md`",
      "- Add criteria as `- [ ] ISC-1: ...` checkboxes under `## Criteria`",
      "- Apply the Splitting Test; split any compound criteria into atomics",
      "- Set frontmatter `progress: 0/N` and update it as criteria pass",
      "- Write task context directly under `## Context`",
      "",
      "OUTPUT:",
    ].join("\n")
  );

  assertAlgorithmAdapted(out);
  return out;
}

function loadAlgorithm(): string {
  const latestFile = join(ALGORITHM_DIR, "LATEST");
  const version = readFileSync(latestFile, "utf-8").trim();
  const algorithmFile = join(ALGORITHM_DIR, `${version}.md`);
  const raw = readFileSync(algorithmFile, "utf-8");
  return adaptAlgorithmForOpenCode(raw);
}

function injectBuiltTimestamp(frontmatter: string, timestamp: string): string {
  // Only inject if a Built line isn't present yet.
  if (/^\s*Built:\s+/m.test(frontmatter)) return frontmatter;

  // Insert `Built:` immediately after the first `Build:` line.
  return frontmatter.replace(
    /^\s*Build:\s+.*$/m,
    (match) => `${match}\n  Built:  ${timestamp}`
  );
}

const components = readdirSync(COMPONENTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort((a, b) => {
    const numA = parseInt(a.split("-")[0], 10) || 0;
    const numB = parseInt(b.split("-")[0], 10) || 0;
    return numA - numB;
  });

if (components.length === 0) {
  console.error("❌ No component files found in Components/");
  process.exit(1);
}

const timestamp = getTimestamp();
const algorithmContent = loadAlgorithm();

let output = "";

for (const file of components) {
  let content = readFileSync(join(COMPONENTS_DIR, file), "utf-8");

  if (file === "00-frontmatter.md") {
    content = injectBuiltTimestamp(content, timestamp);
  }

  if (content.includes("{{ALGORITHM_VERSION}}")) {
    content = content.replace("{{ALGORITHM_VERSION}}", algorithmContent);
  }

  output += content;
}

const variables = loadVariables();
output = resolveVariables(output, variables);

writeFileSync(OUTPUT_FILE, output);

console.log(`✅ Built SKILL.md from ${components.length} components`);
console.log(`📄 Output: ${OUTPUT_FILE}`);
