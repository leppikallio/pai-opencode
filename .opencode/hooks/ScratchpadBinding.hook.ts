#!/usr/bin/env bun

import { fileLogError } from "../plugins/lib/file-logger";
import { ensureScratchpadSession } from "../plugins/lib/scratchpad";
import { readStdinWithTimeout } from "./lib/stdin";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function renderScratchpadReminder(scratchpadDir: string): string {
  return [
    "<system-reminder>",
    "PAI SCRATCHPAD (Binding)",
    `ScratchpadDir: ${scratchpadDir}`,
    "Rules:",
    "- If asked for ScratchpadDir, answer with the value above.",
    "- Do NOT run tools (Read/Glob/Bash/etc) to discover it.",
    "</system-reminder>",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  if (process.execArgv.includes("--check")) {
    return;
  }

  try {
    const rawInput = await readStdinWithTimeout({ timeoutMs: 1200 });
    const payload = rawInput.trim() ? asRecord(JSON.parse(rawInput)) : {};
    const sessionId = getString(payload.session_id);
    const rootSessionId = getString(payload.root_session_id) ?? sessionId;
    if (!rootSessionId) {
      return;
    }

    const scratchpad = await ensureScratchpadSession(rootSessionId);
    const scratchpadDir = getString(scratchpad.dir);
    if (!scratchpadDir) {
      return;
    }

    process.stdout.write(renderScratchpadReminder(scratchpadDir));
  } catch (error) {
    fileLogError("[ScratchpadBinding] Failed to render binding", error);
  }
}

await main();
process.exit(0);
