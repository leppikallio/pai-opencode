#!/usr/bin/env bun

import { readStdinWithTimeout } from "./lib/stdin";

type JsonRecord = Record<string, unknown>;

type HookInput = {
  tool_name?: string;
  tool_input?: {
    run_in_background?: boolean;
    subagent_type?: string;
    description?: string;
    prompt?: string;
    model?: string;
  };
};

const FAST_AGENT_TYPES = new Set(["explore", "fast"]);

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonRecord;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isFastAgentType(subagentType: string): boolean {
  const normalized = subagentType.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (FAST_AGENT_TYPES.has(normalized)) {
    return true;
  }

  return /(^|[-_/\s])(explore|fast)($|[-_/\s])/i.test(normalized);
}

function isFastModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (/(^|[-_/\s])haiku($|[-_/\s])/i.test(normalized)) {
    return true;
  }

  return /(^|[-_/\s])fast($|[-_/\s])/.test(normalized);
}

function hasFastScope(prompt: string): boolean {
  const lines = prompt.split(/\r?\n/);
  const scopeHeaderIndex = lines.findIndex((line) => /^\s*##\s*Scope\b/i.test(line));
  if (scopeHeaderIndex === -1) {
    return false;
  }

  let scopeBlock = "";
  for (let i = scopeHeaderIndex; i < lines.length; i += 1) {
    if (i > scopeHeaderIndex && /^\s*##\s+/.test(lines[i])) {
      break;
    }
    scopeBlock += `${lines[i]}\n`;
  }

  return /Timing:\s*FAST\b/i.test(scopeBlock);
}

async function main(): Promise<void> {
  try {
    const stdin = await readStdinWithTimeout({ timeoutMs: 1000 });
    if (!stdin.trim()) {
      return;
    }

    const parsed = JSON.parse(stdin) as HookInput;
    const payload = asRecord(parsed);
    if (!payload) {
      return;
    }

    const toolName = asString(payload.tool_name);
    if (!toolName.trim()) {
      return;
    }

    if (toolName.toLowerCase() !== "task") {
      return;
    }

    const toolInput = asRecord(payload.tool_input) ?? {};

    if (toolInput.run_in_background === true) {
      return;
    }

    const agentType = asString(toolInput.subagent_type);
    if (isFastAgentType(agentType)) {
      return;
    }

    const model = asString(toolInput.model);
    if (isFastModel(model)) {
      return;
    }

    const prompt = asString(toolInput.prompt);
    if (hasFastScope(prompt)) {
      return;
    }

    const description = asString(toolInput.description).trim() || agentType || "unknown";

    process.stdout.write(`<system-reminder>
WARNING: FOREGROUND AGENT DETECTED - "${description}" (${agentType || "unknown"})
run_in_background is missing or false. This may block the user interface.

FIX: Add run_in_background: true to this Task call.

Only FAST exceptions pass inline:
- run_in_background: true
- fast/explore agent types
- fast-tier model (for example, haiku)
- ## Scope with Timing: FAST
</system-reminder>\n`);
  } catch {
    // Never block hook execution on parse/runtime errors.
  }
}

await main();
process.exit(0);
