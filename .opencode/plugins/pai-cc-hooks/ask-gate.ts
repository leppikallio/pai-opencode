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

const askGateByConfirmId = new Map<string, AskGateEntry>();
const askGateByKey = new Map<string, AskGateEntry>();

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

export function pruneAskGate(nowMs: number = Date.now()): void {
	for (const [confirmId, entry] of askGateByConfirmId.entries()) {
		if (nowMs - entry.createdAt > ASK_GATE_TTL_MS) {
			askGateByConfirmId.delete(confirmId);
			if (askGateByKey.get(entry.key)?.confirmId === confirmId) {
				askGateByKey.delete(entry.key);
			}
		}
	}
}

export function markAskGateConfirmed(confirmId: string, nowMs: number = Date.now()):
	| AskGateEntry
	| undefined {
	pruneAskGate(nowMs);
	const pending = askGateByConfirmId.get(confirmId);
	if (pending && !pending.confirmedAt) {
		pending.confirmedAt = nowMs;
		askGateByConfirmId.set(confirmId, pending);
		askGateByKey.set(pending.key, pending);
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
	pruneAskGate(nowMs);

	const key = buildAskGateKey({
		sessionId: args.sessionId,
		toolName: args.toolName,
		toolInput: args.toolInput,
	});

	const existing = askGateByKey.get(key);
	if (existing?.confirmedAt && nowMs - existing.confirmedAt < ASK_GATE_TTL_MS) {
		askGateByKey.delete(key);
		askGateByConfirmId.delete(existing.confirmId);
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
	pruneAskGate(nowMs);

	const confirmId = newConfirmId();
	const key = buildAskGateKey({
		sessionId: args.sessionId,
		toolName: args.toolName,
		toolInput: args.toolInput,
	});

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

export function __resetAskGateForTests(): void {
	askGateByConfirmId.clear();
	askGateByKey.clear();
}
