#!/usr/bin/env bun

import { shouldAskForForegroundTask } from "../plugins/pai-cc-hooks/claude/agent-execution-guard";
import { readStdinWithTimeout } from "./lib/stdin";

type JsonRecord = Record<string, unknown>;

type HookInput = {
	tool_name?: string;
	tool_input?: {
		run_in_background?: boolean;
		runInBackground?: boolean;
		subagent_type?: string;
		description?: string;
		prompt?: string;
	};
};

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

function asBoolean(value: unknown): boolean {
	return value === true;
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
		const runInBackground =
			asBoolean(toolInput.run_in_background) || asBoolean(toolInput.runInBackground);

		if (runInBackground) {
			return;
		}

		const agentType = asString(toolInput.subagent_type);
		const prompt = asString(toolInput.prompt);
		if (
			!shouldAskForForegroundTask({
				subagent_type: agentType,
				prompt,
			})
		) {
			return;
		}

		const description = asString(toolInput.description).trim() || agentType || "unknown";

		process.stdout.write(`<system-reminder>
BACKGROUND RECOMMENDATION: "${description}" (${agentType || "unknown"}) appears long-running or fan-out.
Foreground execution is still available, but this may block the user interface.

If non-blocking execution is preferred, set run_in_background: true on this Task call.

Foreground-first policy reminder:
- Default interactive tasks may run in foreground
- Prefer run_in_background: true for explicit long-running or fan-out work
</system-reminder>\n`);
	} catch {
		// Never block hook execution on parse/runtime errors.
	}
}

await main();
process.exit(0);
