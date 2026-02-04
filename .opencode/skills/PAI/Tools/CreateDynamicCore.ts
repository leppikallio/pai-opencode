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

function loadAlgorithm(): string {
  const latestFile = join(ALGORITHM_DIR, "LATEST");
  const version = readFileSync(latestFile, "utf-8").trim();
  const algorithmFile = join(ALGORITHM_DIR, `${version}.md`);
  return readFileSync(algorithmFile, "utf-8");
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
    const numA = parseInt(a.split("-")[0]) || 0;
    const numB = parseInt(b.split("-")[0]) || 0;
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
