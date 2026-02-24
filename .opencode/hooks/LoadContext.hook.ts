#!/usr/bin/env bun

import {
  REQUIRED_SKILL_RELATIVE_PATH,
  hasRequiredSkillFile,
  loadContextBundle,
} from "./lib/context-loader";
import { getPaiDir } from "./lib/paths";

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

function isSubagent(): boolean {
  const claudeAgentType = process.env.CLAUDE_AGENT_TYPE ?? "";
  const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR ?? "";
  return claudeProjectDir.includes("/.claude/Agents/") || claudeAgentType.trim().length > 0;
}

function renderReminder(content: string): string {
  return `<system-reminder>\n${content}\n</system-reminder>\n`;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}

function allowMissingConfiguredContextFiles(): boolean {
  return process.env.PAI_ALLOW_MISSING_CONTEXT_FILES === "1";
}

function main(): void {
  if (isSubagent()) {
    process.exit(0);
  }

  const paiDir = getPaiDir();
  if (!hasRequiredSkillFile(paiDir)) {
    fail(`[LoadContext] Missing required file: ${REQUIRED_SKILL_RELATIVE_PATH}`);
  }

  let context: ReturnType<typeof loadContextBundle>;
  try {
    context = loadContextBundle(paiDir);
  } catch (error) {
    if (error instanceof Error) {
      fail(error.message);
    }

    fail(`[LoadContext] Failed to load context: ${String(error)}`);
  }

  if (context.missingFiles.includes(REQUIRED_SKILL_RELATIVE_PATH)) {
    fail(`[LoadContext] Missing required file: ${REQUIRED_SKILL_RELATIVE_PATH}`);
  }

  if (context.missingFiles.length > 0) {
    if (context.usesConfiguredContextFiles) {
      const message = `[LoadContext] Missing configured context file(s): ${context.missingFiles.join(", ")}`;
      if (allowMissingConfiguredContextFiles()) {
        warn(`${message} (continuing because PAI_ALLOW_MISSING_CONTEXT_FILES=1)`);
      } else {
        fail(`${message}. Set PAI_ALLOW_MISSING_CONTEXT_FILES=1 to continue.`);
      }
    } else {
      for (const missingFile of context.missingFiles) {
        warn(`[LoadContext] Missing optional context file: ${missingFile}`);
      }
    }
  }

  if (!context.combinedContent.trim()) {
    fail("[LoadContext] No context content loaded");
  }

  process.stdout.write(renderReminder(context.combinedContent));
  process.exit(0);
}

main();
