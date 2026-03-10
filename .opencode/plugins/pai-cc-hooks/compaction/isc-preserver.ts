import fs from "node:fs";
import path from "node:path";

import {
	PAI_COMPACTION_DERIVED_CONTINUITY_SCHEMA,
	type PaiCompactionContinuationBundleV1,
	type PaiCompactionDerivedContinuityStateV1,
} from "../../adapters/types";
import {
	clearDerivedContinuityStateForSession,
	getDerivedContinuityStateForSession,
	setDerivedContinuityStateForSession,
} from "../../handlers/work-tracker";
import { getStateDir } from "../../lib/paths";

type CompactionContinuityStateV1 = {
	v: "0.1";
	updatedAt: string;
	sessions: Record<
		string,
		{
			snapshotAt: string;
			lastRestoredAt?: string;
			restoreCount: number;
			derived: PaiCompactionDerivedContinuityStateV1;
		}
	>;
};

function normalizeSessionId(sessionIdRaw: string): string {
	const trimmed = sessionIdRaw.trim();
	if (!trimmed) return "";
	if (trimmed.length > 128) return "";
	if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return "";
	return trimmed;
}

function optionalTrimmed(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeStringArray(value: unknown, maxItems: number): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") {
			continue;
		}

		const trimmed = item.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}

		out.push(trimmed);
		seen.add(trimmed);
		if (out.length >= maxItems) {
			break;
		}
	}

	return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function sanitizeDerivedState(
	state: Partial<PaiCompactionDerivedContinuityStateV1> | null | undefined,
): PaiCompactionDerivedContinuityStateV1 | null {
	if (!state || !isRecord(state)) {
		return null;
	}

	const updatedAt = optionalTrimmed(state.updatedAt) ?? new Date().toISOString();

	return {
		schema: PAI_COMPACTION_DERIVED_CONTINUITY_SCHEMA,
		updatedAt,
		workPath: optionalTrimmed(state.workPath),
		activeWorkSlug: optionalTrimmed(state.activeWorkSlug),
		prdProgress: optionalTrimmed(state.prdProgress),
		prdPhase: optionalTrimmed(state.prdPhase),
		nextUnfinishedIscIds: normalizeStringArray(state.nextUnfinishedIscIds, 24),
		nextUnfinishedIscTexts: normalizeStringArray(state.nextUnfinishedIscTexts, 24),
		activeBackgroundTaskIds: normalizeStringArray(state.activeBackgroundTaskIds, 24),
		continuationHints: normalizeStringArray(state.continuationHints, 16),
	};
}

function createDefaultState(nowIso = new Date().toISOString()): CompactionContinuityStateV1 {
	return {
		v: "0.1",
		updatedAt: nowIso,
		sessions: {},
	};
}

export function getCompactionIscPreservationPath(): string {
	return path.join(getStateDir(), "compaction-continuity.json");
}

async function readState(statePath: string): Promise<CompactionContinuityStateV1> {
	let raw: string;
	try {
		raw = await fs.promises.readFile(statePath, "utf-8");
	} catch {
		return createDefaultState();
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return createDefaultState();
	}

	if (!isRecord(parsed) || !isRecord(parsed.sessions)) {
		return createDefaultState();
	}

	const sessions: CompactionContinuityStateV1["sessions"] = {};
	for (const [sessionIdRaw, value] of Object.entries(parsed.sessions)) {
		const sessionId = normalizeSessionId(sessionIdRaw);
		if (!sessionId || !isRecord(value)) {
			continue;
		}

		const derived = sanitizeDerivedState(
			isRecord(value.derived)
				? (value.derived as Partial<PaiCompactionDerivedContinuityStateV1>)
				: undefined,
		);
		if (!derived) {
			continue;
		}

		const snapshotAt = optionalTrimmed(value.snapshotAt) ?? derived.updatedAt;
		const lastRestoredAt = optionalTrimmed(value.lastRestoredAt);
		const restoreCountRaw = value.restoreCount;
		const restoreCount =
			typeof restoreCountRaw === "number" && Number.isFinite(restoreCountRaw)
				? Math.max(0, Math.floor(restoreCountRaw))
				: 0;

		sessions[sessionId] = {
			snapshotAt,
			...(lastRestoredAt ? { lastRestoredAt } : {}),
			restoreCount,
			derived,
		};
	}

	return {
		v: "0.1",
		updatedAt: optionalTrimmed(parsed.updatedAt) ?? new Date().toISOString(),
		sessions,
	};
}

async function writeState(
	statePath: string,
	state: CompactionContinuityStateV1,
): Promise<void> {
	await fs.promises.mkdir(path.dirname(statePath), { recursive: true });

	const tempPath = `${statePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	await fs.promises.writeFile(
		tempPath,
		`${JSON.stringify(state, null, 2)}\n`,
		"utf-8",
	);

	try {
		await fs.promises.rename(tempPath, statePath);
	} catch (error) {
		try {
			await fs.promises.unlink(tempPath);
		} catch {
			// Best effort cleanup.
		}
		throw error;
	}
}

function deriveContinuityStateFromBundle(
	bundle: PaiCompactionContinuationBundleV1,
): PaiCompactionDerivedContinuityStateV1 {
	return {
		schema: PAI_COMPACTION_DERIVED_CONTINUITY_SCHEMA,
		updatedAt: bundle.generatedAt,
		workPath: bundle.currentWork.currentPointer,
		activeWorkSlug: bundle.currentWork.activeSlug,
		prdProgress: bundle.progress.prdProgress,
		prdPhase: bundle.progress.prdPhase,
		nextUnfinishedIscIds: bundle.progress.isc.nextUnfinished.map((item) => item.id),
		nextUnfinishedIscTexts: bundle.progress.isc.nextUnfinished.map(
			(item) => item.text,
		),
		activeBackgroundTaskIds: [...bundle.background.pendingTaskIds],
		continuationHints: [...bundle.continuationHints],
	};
}
export async function snapshotCompactionDerivedState(args: {
	sessionId: string;
	bundle: PaiCompactionContinuationBundleV1;
	now?: Date;
}): Promise<PaiCompactionDerivedContinuityStateV1 | null> {
	const sessionId = normalizeSessionId(args.sessionId);
	if (!sessionId) {
		return null;
	}

	const nowIso = (args.now ?? new Date()).toISOString();
	const derived = deriveContinuityStateFromBundle(args.bundle);
	derived.updatedAt = nowIso;

	setDerivedContinuityStateForSession(sessionId, {
		updatedAt: derived.updatedAt,
		workPath: derived.workPath,
		activeWorkSlug: derived.activeWorkSlug,
		prdProgress: derived.prdProgress,
		prdPhase: derived.prdPhase,
		nextUnfinishedIscIds: derived.nextUnfinishedIscIds,
		nextUnfinishedIscTexts: derived.nextUnfinishedIscTexts,
		activeBackgroundTaskIds: derived.activeBackgroundTaskIds,
		continuationHints: derived.continuationHints,
	});

	const statePath = getCompactionIscPreservationPath();
	const state = await readState(statePath);
	state.sessions[sessionId] = {
		snapshotAt: nowIso,
		lastRestoredAt: state.sessions[sessionId]?.lastRestoredAt,
		restoreCount: state.sessions[sessionId]?.restoreCount ?? 0,
		derived,
	};
	state.updatedAt = nowIso;

	await writeState(statePath, state);
	return derived;
}

export async function rehydrateCompactionDerivedStateOnParentTurn(args: {
	sessionId: string;
	now?: Date;
}): Promise<{ restored: boolean; state?: PaiCompactionDerivedContinuityStateV1 }> {
	const sessionId = normalizeSessionId(args.sessionId);
	if (!sessionId) {
		return { restored: false };
	}

	if (getDerivedContinuityStateForSession(sessionId)) {
		return { restored: false };
	}

	const statePath = getCompactionIscPreservationPath();
	const state = await readState(statePath);
	const entry = state.sessions[sessionId];
	if (!entry) {
		return { restored: false };
	}

	const nowIso = (args.now ?? new Date()).toISOString();
	const derived = sanitizeDerivedState(entry.derived);
	if (!derived) {
		clearDerivedContinuityStateForSession(sessionId);
		return { restored: false };
	}

	derived.updatedAt = nowIso;
	setDerivedContinuityStateForSession(sessionId, {
		updatedAt: derived.updatedAt,
		workPath: derived.workPath,
		activeWorkSlug: derived.activeWorkSlug,
		prdProgress: derived.prdProgress,
		prdPhase: derived.prdPhase,
		nextUnfinishedIscIds: derived.nextUnfinishedIscIds,
		nextUnfinishedIscTexts: derived.nextUnfinishedIscTexts,
		activeBackgroundTaskIds: derived.activeBackgroundTaskIds,
		continuationHints: derived.continuationHints,
	});

	state.sessions[sessionId] = {
		...entry,
		lastRestoredAt: nowIso,
		restoreCount: Math.max(0, entry.restoreCount ?? 0) + 1,
		derived,
	};
	state.updatedAt = nowIso;
	await writeState(statePath, state);

	return {
		restored: true,
		state: derived,
	};
}

export async function readCompactionDerivedStateForTests(): Promise<CompactionContinuityStateV1> {
	return readState(getCompactionIscPreservationPath());
}
