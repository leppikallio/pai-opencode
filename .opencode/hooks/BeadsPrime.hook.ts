#!/usr/bin/env bun

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { getPaiDir } from "./lib/paths";
import { readStdinWithTimeout } from "./lib/stdin";

const MAX_REMINDER_CHARS = 4000;
const PRIME_TIMEOUT_MS = 1500;
const PRIME_TIMEOUT_SENTINEL = Symbol("beads_prime_timeout");

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

function readSettings(): UnknownRecord {
	const settingsPath = path.join(getPaiDir(), "settings.json");
	if (!existsSync(settingsPath)) {
		return {};
	}

	try {
		return asRecord(JSON.parse(readFileSync(settingsPath, "utf8")));
	} catch {
		return {};
	}
}

function parsePayload(rawInput: string): UnknownRecord {
	if (!rawInput.trim()) {
		return {};
	}

	try {
		return asRecord(JSON.parse(rawInput));
	} catch {
		return {};
	}
}

function isBeadsFeatureEnabled(): boolean {
	const settings = readSettings();
	const paiFeatures = asRecord(settings.paiFeatures);
	const beads = paiFeatures.beads;
	if (beads === false) {
		return false;
	}

	return true;
}

function isRootSession(payload: UnknownRecord): boolean {
	const sessionId = getString(payload.session_id);
	const rootSessionId = getString(payload.root_session_id) ?? sessionId;
	return Boolean(sessionId && rootSessionId && sessionId === rootSessionId);
}

function isBeadsRepo(cwd: string): boolean {
	const beadsPath = path.join(cwd, ".beads");
	if (!existsSync(beadsPath)) {
		return false;
	}

	try {
		return statSync(beadsPath).isDirectory();
	} catch {
		return false;
	}
}

function replaceControlCharacters(content: string): string {
	let result = "";
	for (const character of content) {
		const codePoint = character.codePointAt(0);
		if (
			codePoint !== undefined &&
			(codePoint === 0x7f ||
				(codePoint <= 0x1f &&
					codePoint !== 0x09 &&
					codePoint !== 0x0a &&
					codePoint !== 0x0d))
		) {
			result += " ";
			continue;
		}

		result += character;
	}

	return result;
}

function sanitizeOutput(content: string): string {
	const sanitized = replaceControlCharacters(content)
		.replace(/`/g, "'")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.trim();

	if (sanitized.length <= MAX_REMINDER_CHARS) {
		return sanitized;
	}

	return `${sanitized.slice(0, MAX_REMINDER_CHARS).trimEnd()}...`;
}

async function runBeadsPrime(args: {
	bdPath: string;
	cwd: string;
}): Promise<string> {
	const proc = Bun.spawn([args.bdPath, "prime", "--stealth"], {
		cwd: args.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<typeof PRIME_TIMEOUT_SENTINEL>((resolve) => {
		timeoutHandle = setTimeout(() => resolve(PRIME_TIMEOUT_SENTINEL), PRIME_TIMEOUT_MS);
	});

	try {
		const result = await Promise.race([
			Promise.all([new Response(proc.stdout).text(), proc.exited]),
			timeout,
		]);

		if (result === PRIME_TIMEOUT_SENTINEL) {
			try {
				proc.kill("SIGKILL");
			} catch {
				try {
					proc.kill();
				} catch {
					// Ignore kill failures.
				}
			}

			return "";
		}

		const [stdout, exitCode] = result;
		if (exitCode !== 0) {
			return "";
		}

		return stdout;
	} catch {
		return "";
	} finally {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
		}
	}
}

function renderReminder(content: string): string {
	return `<system-reminder>\n${content}\n</system-reminder>\n`;
}

async function main(): Promise<void> {
	if (process.execArgv.includes("--check")) {
		return;
	}

	const rawInput = await readStdinWithTimeout({ timeoutMs: 1200 });
	const payload = parsePayload(rawInput);
	if (!isRootSession(payload)) {
		return;
	}

	if (!isBeadsFeatureEnabled()) {
		return;
	}

	const cwd = getString(payload.cwd) ?? process.cwd();
	if (!isBeadsRepo(cwd)) {
		return;
	}

	const bdPath = Bun.which("bd");
	if (!bdPath) {
		return;
	}

	const primeOutput = await runBeadsPrime({ bdPath, cwd });
	const bounded = sanitizeOutput(primeOutput);
	if (!bounded) {
		return;
	}

	process.stdout.write(renderReminder(bounded));
}

await main();
process.exit(0);
