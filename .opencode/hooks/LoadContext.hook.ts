#!/usr/bin/env bun

import {
  loadContextBundle,
} from "./lib/context-loader";
import { getPaiDir } from "./lib/paths";

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

function isSubagent(): boolean {
  const agentType = (process.env.OPENCODE_AGENT_TYPE ?? "").trim();
  const projectDir = (process.env.OPENCODE_PROJECT_DIR ?? "").trim();
  return agentType.length > 0 || projectDir.includes("/.opencode/agents/");
}

function renderReminder(content: string): string {
  return `<system-reminder>\n${content}\n</system-reminder>\n`;
}

function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}

function warnLegacySubagentMarkers(): void {
  const projectDir = (process.env.OPENCODE_PROJECT_DIR ?? "").trim();
  if (projectDir.includes("/.opencode/Agents/")) {
    warn("[LoadContext] Ignoring uppercase agent marker; use /.opencode/agents/");
  }

  if ((process.env.CLAUDE_AGENT_TYPE ?? "").trim().length > 0 || (process.env.CLAUDE_PROJECT_DIR ?? "").trim().length > 0) {
    warn("[LoadContext] Ignoring legacy CLAUDE_* subagent markers");
  }
}

function replaceControlCharacters(content: string): string {
  let result = "";
  for (const character of content) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined
      && (codePoint === 0x7f || (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d))
    ) {
      result += " ";
      continue;
    }

    result += character;
  }

  return result;
}

function sanitizeOutput(content: string, maxChars: number): string {
  const sanitized = replaceControlCharacters(content)
    .replace(/`/g, "'")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();
  if (sanitized.length <= maxChars) {
    return sanitized;
  }

  return `${sanitized.slice(0, maxChars).trimEnd()}…`;
}

function main(): void {
  warnLegacySubagentMarkers();

  if (isSubagent()) {
    process.exit(0);
  }

  const paiDir = getPaiDir();

  let context: ReturnType<typeof loadContextBundle>;
  try {
    context = loadContextBundle(paiDir);
  } catch (error) {
    if (error instanceof Error) {
      warn(error.message);
      process.exit(0);
    }

    warn(`[LoadContext] Failed to load context: ${String(error)}`);
    process.exit(0);
  }

  for (const warning of context.warnings) {
    warn(warning);
  }

  if (context.missingFiles.length > 0) {
    for (const missingFile of context.missingFiles) {
      warn(`[LoadContext] Missing optional context file: ${missingFile}`);
    }
  }

  const bounded = sanitizeOutput(context.combinedContent, 14000);
  if (!bounded) {
    process.exit(0);
  }

  process.stdout.write(renderReminder(bounded));
  process.exit(0);
}

main();
