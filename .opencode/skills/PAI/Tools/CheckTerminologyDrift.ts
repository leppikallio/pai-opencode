#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Finding = {
  file: string;
  line: number;
  kind: "noncanonical-thinking-token" | "stale-development-skill";
  text: string;
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.join(currentDir, "..");

function resolveLatestAlgorithmFile(): string {
  const latestPath = path.join(skillRoot, "Components", "Algorithm", "LATEST");
  try {
    const latest = fs.readFileSync(latestPath, "utf8").trim();
    if (latest.length > 0) {
      return `Components/Algorithm/${latest}.md`;
    }
  } catch {
    // fall through
  }
  return "Components/Algorithm/v0.2.25.md";
}

const canonicalFiles = [
  resolveLatestAlgorithmFile(),
  "SYSTEM/PAIAGENTSYSTEM.md",
  "SYSTEM/THEDELEGATIONSYSTEM.md",
  "SYSTEM/DOCUMENTATIONINDEX.md",
  "Workflows/SessionContinuity.md",
  "Workflows/TreeOfThought.md",
];

const badThinkingToken = /\b(Council|RedTeam|FirstPrinciples|BeCreative|Becreative)\b/;
const staleDevelopmentSkill = /\bDevelopment Skill\b/;

function readLines(filePath: string): string[] {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/);
}

function walkMarkdown(root: string): string[] {
  const out: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
        out.push(full);
      }
    }
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function toRelative(fullPath: string): string {
  return path.relative(skillRoot, fullPath).split("\\").join("/");
}

function isAllowedDevelopmentAliasLine(rel: string, line: string): boolean {
  if (rel === "Components/16-opencode-openai-adapter.md") return true;
  if (rel === "SYSTEM/SkillSystem/Validation.md" && line.includes("stale `Development Skill` phrasing")) {
    return true;
  }
  if (rel === "SKILL.md" && line.includes("conceptual umbrella")) return true;
  return line.includes("conceptual umbrella");
}

const findings: Finding[] = [];

for (const rel of canonicalFiles) {
  const full = path.join(skillRoot, rel);
  if (!fs.existsSync(full)) continue;

  const lines = readLines(full);
  const changelogStart = lines.findIndex((line) => line.trim() === "## Changelog");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inChangelog = changelogStart !== -1 && i >= changelogStart;
    if (inChangelog) continue;
    const isLocalizationAliasLine =
      rel.startsWith("Components/Algorithm/") &&
      (line.includes("Algorithm term") || line.includes("`Council` / `RedTeam` / `FirstPrinciples` / `BeCreative`"));
    if (isLocalizationAliasLine) continue;
    if (badThinkingToken.test(line)) {
      findings.push({
        file: rel,
        line: i + 1,
        kind: "noncanonical-thinking-token",
        text: line.trim(),
      });
    }
  }
}

for (const full of walkMarkdown(skillRoot)) {
  const rel = toRelative(full);
  if (rel === "SKILL.md") continue;

  const lines = readLines(full);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!staleDevelopmentSkill.test(line)) continue;
    if (isAllowedDevelopmentAliasLine(rel, line)) continue;

    findings.push({
      file: rel,
      line: i + 1,
      kind: "stale-development-skill",
      text: line.trim(),
    });
  }
}

if (findings.length === 0) {
  console.log("CheckTerminologyDrift: OK");
  process.exit(0);
}

console.log(`CheckTerminologyDrift: ${findings.length} issue(s)`);
for (const f of findings) {
  console.log(`- ${f.file}:${f.line} [${f.kind}] ${f.text}`);
}

process.exit(1);
