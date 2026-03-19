import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

import { getStateDir } from "../lib/paths";
import type { UnknownRecord } from "./types";
import { stableStringify } from "./stable-stringify";

export type AskGateEntry = {
	confirmId: string;
	createdAt: number;
	confirmedAt?: number;
	key: string;
	reason?: string;
	hookName?: string;
	toolName?: string;
	inputLines?: string;
};

// Hook "ask" decisions can't currently trigger OpenCode's permission UI
// (PermissionNext.ask) from tool.execute.before. Instead, we block the tool and
// require an explicit user confirmation message.
export const ASK_GATE_TTL_MS = 5 * 60 * 1000;
const ASK_GATE_STATE_FILE_ENV = "PAI_CC_HOOKS_ASK_GATE_STATE_PATH";

const askGateByConfirmId = new Map<string, AskGateEntry>();
const askGateByKey = new Map<string, AskGateEntry>();
const confirmedAskGateByKey = new Map<string, number>();

type AskGateStateFileV1 = {
	version: 1;
	entries: AskGateEntry[];
};

function getAskGateStatePath(): string {
	const override = process.env[ASK_GATE_STATE_FILE_ENV]?.trim();
	if (override) {
		return override;
	}

	return path.join(getStateDir(), "security-ask-gate.json");
}

function isAskGateEntry(value: unknown): value is AskGateEntry {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.confirmId === "string" &&
		typeof candidate.createdAt === "number" &&
		typeof candidate.key === "string" &&
		(candidate.confirmedAt === undefined ||
			typeof candidate.confirmedAt === "number") &&
		(candidate.reason === undefined || typeof candidate.reason === "string") &&
		(candidate.hookName === undefined || typeof candidate.hookName === "string") &&
		(candidate.toolName === undefined || typeof candidate.toolName === "string") &&
		(candidate.inputLines === undefined ||
			typeof candidate.inputLines === "string")
	);
}

function loadAskGateEntriesFromDisk(): AskGateEntry[] {
	const statePath = getAskGateStatePath();
	if (!existsSync(statePath)) {
		return [];
	}

	try {
		const parsed = JSON.parse(readFileSync(statePath, "utf8")) as {
			version?: unknown;
			entries?: unknown;
		};
		if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
			return [];
		}

		return parsed.entries.filter(isAskGateEntry);
	} catch {
		return [];
	}
}

function writeAskGateEntriesToDisk(entries: AskGateEntry[]): void {
	const statePath = getAskGateStatePath();
	const dirPath = path.dirname(statePath);
	mkdirSync(dirPath, { recursive: true });

	if (entries.length === 0) {
		rmSync(statePath, { force: true });
		return;
	}

	const tmpPath = `${statePath}.${process.pid}.tmp`;
	const payload: AskGateStateFileV1 = {
		version: 1,
		entries,
	};
	writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	renameSync(tmpPath, statePath);
}

function replaceAskGateMaps(entries: AskGateEntry[]): void {
	askGateByConfirmId.clear();
	askGateByKey.clear();

	for (const entry of entries) {
		askGateByConfirmId.set(entry.confirmId, entry);
		askGateByKey.set(entry.key, entry);
	}
}

function syncAskGateFromDisk(nowMs: number = Date.now()): void {
	replaceAskGateMaps(loadAskGateEntriesFromDisk());
	pruneAskGate(nowMs, false);
}

export function buildAskGateKey(args: {
	sessionId: string;
	toolName: string;
	toolInput: UnknownRecord;
}): string {
	return `${args.sessionId}:${args.toolName}:${stableStringify(args.toolInput)}`;
}

function newConfirmId(): string {
	return `pai_confirm_${Math.random().toString(36).slice(2, 10)}`;
}

export function parseConfirmMessage(text: string): string | undefined {
	const trimmed = text.trim();
	const match = trimmed.match(
		/^(?:PAI_CONFIRM|pai_confirm)\s+([a-zA-Z0-9_-]+)$/,
	);
	return match?.[1];
}

export function pruneAskGate(
	nowMs: number = Date.now(),
	persistToDisk: boolean = true,
): void {
	let mutated = false;
	for (const [confirmId, entry] of askGateByConfirmId.entries()) {
		if (nowMs - entry.createdAt > ASK_GATE_TTL_MS) {
			askGateByConfirmId.delete(confirmId);
			mutated = true;
			if (askGateByKey.get(entry.key)?.confirmId === confirmId) {
				askGateByKey.delete(entry.key);
			}
		}
	}

	if (persistToDisk && mutated) {
		writeAskGateEntriesToDisk([...askGateByConfirmId.values()]);
	}
}

export function markAskGateConfirmed(confirmId: string, nowMs: number = Date.now()):
	| AskGateEntry
	| undefined {
	syncAskGateFromDisk(nowMs);
	const pending = askGateByConfirmId.get(confirmId);
	if (pending && !pending.confirmedAt) {
		pending.confirmedAt = nowMs;
		confirmedAskGateByKey.set(pending.key, nowMs);
		askGateByConfirmId.delete(confirmId);
		if (askGateByKey.get(pending.key)?.confirmId === confirmId) {
			askGateByKey.delete(pending.key);
		}
		writeAskGateEntriesToDisk([...askGateByConfirmId.values()]);
	}

	return pending;
}

export function confirmAskGatePrompt(prompt: string, nowMs: number = Date.now()):
	| AskGateEntry
	| undefined {
	const confirmId = parseConfirmMessage(prompt);
	if (!confirmId) {
		return undefined;
	}

	return markAskGateConfirmed(confirmId, nowMs);
}

export function consumeAskGateOneShotAllowance(args: {
	sessionId: string;
	toolName: string;
	toolInput: UnknownRecord;
	nowMs?: number;
}): boolean {
	const nowMs = args.nowMs ?? Date.now();
	syncAskGateFromDisk(nowMs);

	const key = buildAskGateKey({
		sessionId: args.sessionId,
		toolName: args.toolName,
		toolInput: args.toolInput,
	});
	const confirmedAt = confirmedAskGateByKey.get(key);
	if (confirmedAt && nowMs - confirmedAt < ASK_GATE_TTL_MS) {
		confirmedAskGateByKey.delete(key);
		return true;
	}

	if (confirmedAt) {
		confirmedAskGateByKey.delete(key);
	}

	const existing = askGateByKey.get(key);
	if (existing?.confirmedAt && nowMs - existing.confirmedAt < ASK_GATE_TTL_MS) {
		askGateByKey.delete(key);
		askGateByConfirmId.delete(existing.confirmId);
		writeAskGateEntriesToDisk([...askGateByConfirmId.values()]);
		return true;
	}

	return false;
}

export function createAskGateEntry(args: {
	sessionId: string;
	toolName: string;
	toolInput: UnknownRecord;
	reason?: string;
	hookName?: string;
	resolvedToolName?: string;
	inputLines?: string;
	nowMs?: number;
}): AskGateEntry {
	const nowMs = args.nowMs ?? Date.now();
	syncAskGateFromDisk(nowMs);

	const key = buildAskGateKey({
		sessionId: args.sessionId,
		toolName: args.toolName,
		toolInput: args.toolInput,
	});

	const existing = askGateByKey.get(key);
	confirmedAskGateByKey.delete(key);
	if (existing && !existing.confirmedAt && nowMs - existing.createdAt < ASK_GATE_TTL_MS) {
		return existing;
	}

	if (existing) {
		askGateByConfirmId.delete(existing.confirmId);
	}

	const confirmId = newConfirmId();

	const entry: AskGateEntry = {
		confirmId,
		createdAt: nowMs,
		key,
		reason: args.reason,
		hookName: args.hookName,
		toolName: args.resolvedToolName,
		inputLines: args.inputLines,
	};

	askGateByConfirmId.set(confirmId, entry);
	askGateByKey.set(key, entry);
	writeAskGateEntriesToDisk([...askGateByConfirmId.values()]);

	return entry;
}

export function formatAskGateBlockedMessage(args: {
	confirmId: string;
	reason?: string;
	hookName?: string;
	resolvedToolName?: string;
	fallbackToolName?: string;
	inputLines?: string;
}): string {
	const reason = args.reason ? `\nReason: ${args.reason}` : "";
	const hook = args.hookName ? `\nHook: ${args.hookName}` : "";
	const tool = args.resolvedToolName
		? `\nTool: ${args.resolvedToolName}`
		: args.fallbackToolName
			? `\nTool: ${args.fallbackToolName}`
			: "";
	const inputLines = args.inputLines ? `\nInput:\n${args.inputLines}` : "";

	return `Blocked pending confirmation (hook asked).${hook}${tool}${reason}${inputLines}\n\nTo proceed, reply exactly: PAI_CONFIRM ${args.confirmId}`;
}

export function __resetAskGateInMemoryForTests(): void {
	askGateByConfirmId.clear();
	askGateByKey.clear();
	confirmedAskGateByKey.clear();
}

export function __resetAskGateForTests(): void {
	__resetAskGateInMemoryForTests();
	rmSync(getAskGateStatePath(), { force: true });
}
