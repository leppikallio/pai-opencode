import { promises as fs } from "node:fs";

import {
	getRtkCapabilityCachePath,
	type RtkCapabilityRecord,
} from "../rtk/capability";

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

function getString(obj: Record<string, unknown>, key: string): string {
	const value = obj[key];
	return typeof value === "string" ? value : "";
}

function mergeEnv(overrides?: Record<string, string>): Record<string, string> {
	const env: Record<string, string> = {};

	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) {
			env[key] = value;
		}
	}

	for (const [key, value] of Object.entries(overrides ?? {})) {
		env[key] = value;
	}

	return env;
}

function isRtkCapabilityRecord(value: unknown): value is RtkCapabilityRecord {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const record = value as Record<string, unknown>;
	const version = record.version;

	return (
		typeof record.present === "boolean" &&
		(version === null || typeof version === "string") &&
		typeof record.supportsRewrite === "boolean"
	);
}

async function readProcessStdoutText(proc: Bun.Subprocess): Promise<string> {
	if (!(proc.stdout instanceof ReadableStream)) {
		return "";
	}

	const buffer = await new Response(proc.stdout).arrayBuffer();
	return new TextDecoder().decode(buffer);
}

export async function readCachedRtkCapabilityRecord(): Promise<RtkCapabilityRecord | null> {
	try {
		const cachePath = getRtkCapabilityCachePath();
		const raw = await fs.readFile(cachePath, "utf8");
		const parsed = JSON.parse(raw);
		return isRtkCapabilityRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export async function maybeRewriteBashToolInputWithRtk(args: {
	toolName: string;
	toolInput: Record<string, unknown>;
	env?: Record<string, string>;
}): Promise<Record<string, unknown> | null> {
	if (args.toolName !== "bash") {
		return null;
	}

	const command = getString(args.toolInput, "command");
	if (!command || command.startsWith("rtk ")) {
		return null;
	}

	const capability = await readCachedRtkCapabilityRecord();
	if (!capability?.supportsRewrite) {
		return null;
	}

	const workdir = getString(args.toolInput, "workdir");

	let proc: Bun.Subprocess;
	try {
		proc = Bun.spawn(["rtk", "rewrite", command], {
			cwd: workdir || undefined,
			env: mergeEnv(args.env),
			stdout: "pipe",
			stderr: "ignore",
		});
	} catch {
		return null;
	}

	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		return null;
	}

	const rewritten = (await readProcessStdoutText(proc)).trim();
	if (!rewritten || rewritten === command) {
		return null;
	}

	return {
		...asRecord(args.toolInput),
		command: rewritten,
	};
}
