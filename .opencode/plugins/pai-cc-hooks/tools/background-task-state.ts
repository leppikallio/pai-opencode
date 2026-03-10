import fs from "node:fs";
import path from "node:path";

import {
	isBackgroundTaskActive,
	normalizeBackgroundTaskLifecycle,
	selectTerminalReasonByPrecedence,
	type BackgroundTaskStatus,
	type BackgroundTaskTerminalReason,
} from "../background/lifecycle-normalizer";
import { getPaiDir } from "../../lib/pai-runtime";

const DUPLICATE_WINDOW_MS = 2_000;
const NOTIFIED_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const NOTIFIED_TASK_MAX_ENTRIES = 2_000;
const BACKGROUND_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const BACKGROUND_TASK_MAX_ENTRIES = 2_000;

const LOCK_STALE_MS = 10_000;
const LOCK_MAX_RETRIES = 40;
const LOCK_BASE_DELAY_MS = 10;

type LockFile = {
	ownerId: string;
	createdAt: number;
};

type LockHandle = {
	fileHandle: fs.promises.FileHandle;
	ownerId: string;
};

type SessionDuplicateRecord = {
	messageKey: string;
	atMs: number;
};

export type BackgroundTaskRecord = {
	version?: 1 | 2;
	task_id: string;
	task_description?: string;
	child_session_id: string;
	parent_session_id: string;
	launched_at_ms: number;
	updated_at_ms: number;
	completed_at_ms?: number;
	status?: BackgroundTaskStatus;
	terminal_reason?: BackgroundTaskTerminalReason;
	concurrency_group?: string;
	last_progress_at_ms?: number;
	idle_seen_at_ms?: number;
	completion_attempts?: number;
	launch_error?: string;
	launch_error_at_ms?: number;
};

type BackgroundTaskState = {
	version: 1 | 2;
	updatedAtMs: number;
	notifiedTaskIds: Record<string, number>;
	duplicateBySession: Record<string, SessionDuplicateRecord>;
	backgroundTasks: Record<string, BackgroundTaskRecord>;
};

export type RecordBackgroundTaskLaunchArgs = {
	taskId: string;
	taskDescription?: string;
	childSessionId: string;
	parentSessionId: string;
	status?: BackgroundTaskStatus;
	concurrencyGroup?: string;
	nowMs?: number;
};

export type RecordBackgroundTaskLaunchErrorArgs = {
	taskId: string;
	errorMessage: string;
	nowMs?: number;
};

export type FindBackgroundTaskByChildSessionIdArgs = {
	childSessionId: string;
	nowMs?: number;
};

export type FindBackgroundTaskByTaskIdArgs = {
	taskId: string;
	nowMs?: number;
};

export type MarkBackgroundTaskCompletedArgs = {
	taskId: string;
	nowMs?: number;
};

export type MarkBackgroundTaskCancelledArgs = {
	taskId: string;
	reason?: string;
	nowMs?: number;
};

export type MarkBackgroundTaskFailedArgs = {
	taskId: string;
	errorMessage: string;
	nowMs?: number;
};

export type MarkBackgroundTaskStaleArgs = {
	taskId: string;
	reason?: string;
	nowMs?: number;
};

export type MarkBackgroundTaskTerminalAtomicArgs = {
	taskId: string;
	reason: BackgroundTaskTerminalReason;
	message?: string;
	nowMs?: number;
};

export type RecordBackgroundTaskObservationArgs = {
	taskId: string;
	status: "running" | "idle";
	nowMs?: number;
};

export type ShouldSuppressDuplicateArgs = {
	sessionId: string;
	title: string;
	body: string;
	nowMs?: number;
};

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}

function isMissingFileError(error: unknown): boolean {
	return isErrnoException(error) && error.code === "ENOENT";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function lockRetryDelay(attempt: number): number {
	return Math.min(100, LOCK_BASE_DELAY_MS * (attempt + 1));
}

function resolvePaiDir(): string {
	return getPaiDir();
}

export function getBackgroundTaskStatePath(): string {
	return path.join(resolvePaiDir(), "MEMORY", "STATE", "background-tasks.json");
}

function createDefaultState(nowMs: number): BackgroundTaskState {
	return {
		version: 2,
		updatedAtMs: nowMs,
		notifiedTaskIds: {},
		duplicateBySession: {},
		backgroundTasks: {},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asFiniteNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return value;
}

function asString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	return value;
}

function asNonNegativeInteger(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}

	if (value < 0) {
		return undefined;
	}

	return Math.floor(value);
}

function asVersion(value: unknown): 1 | 2 | undefined {
	const numeric = asFiniteNumber(value);
	if (numeric === 1 || numeric === 2) {
		return numeric;
	}

	return undefined;
}

function asStatus(value: unknown): BackgroundTaskStatus | undefined {
	if (
		value === "queued" ||
		value === "running" ||
		value === "stable_idle" ||
		value === "completed" ||
		value === "failed" ||
		value === "cancelled" ||
		value === "stale"
	) {
		return value;
	}

	return undefined;
}

function asTerminalReason(
	value: unknown,
): BackgroundTaskTerminalReason | undefined {
	if (
		value === "completed" ||
		value === "failed" ||
		value === "cancelled" ||
		value === "stale"
	) {
		return value;
	}

	return undefined;
}

function asOptionalTrimmedString(value: unknown): string | undefined {
	const parsed = asString(value);
	if (!parsed) {
		return undefined;
	}

	const trimmed = parsed.trim();
	return trimmed ? trimmed : undefined;
}

function canonicalizeBackgroundTaskRecord(
	record: BackgroundTaskRecord,
): BackgroundTaskRecord {
	const lifecycle = normalizeBackgroundTaskLifecycle(record);
	return {
		...record,
		version: 2,
		status: lifecycle.status,
		terminal_reason: lifecycle.terminalReason,
		completed_at_ms: lifecycle.completedAtMs,
	};
}

function coerceBackgroundTaskRecord(
	value: unknown,
): BackgroundTaskRecord | null {
	if (!isRecord(value)) {
		return null;
	}

	const taskId = asString(value.task_id);
	const taskDescription = asString(value.task_description) ?? undefined;
	const childSessionId = asString(value.child_session_id);
	const parentSessionId = asString(value.parent_session_id);
	const launchedAtMs = asFiniteNumber(value.launched_at_ms);
	const updatedAtMs = asFiniteNumber(value.updated_at_ms);
	const completedAtMs = asFiniteNumber(value.completed_at_ms) ?? undefined;

	if (
		!taskId ||
		!childSessionId ||
		!parentSessionId ||
		launchedAtMs == null ||
		updatedAtMs == null
	) {
		return null;
	}

	const launchError = asString(value.launch_error) ?? undefined;
	const launchErrorAtMs = asFiniteNumber(value.launch_error_at_ms) ?? undefined;
	const version = asVersion(value.version) ?? 1;
	const status = asStatus(value.status);
	const terminalReason = asTerminalReason(value.terminal_reason);
	const concurrencyGroup = asOptionalTrimmedString(value.concurrency_group);
	const lastProgressAtMs = asFiniteNumber(value.last_progress_at_ms) ?? undefined;
	const idleSeenAtMs = asFiniteNumber(value.idle_seen_at_ms) ?? undefined;
	const completionAttempts = asNonNegativeInteger(value.completion_attempts);

	const normalized = canonicalizeBackgroundTaskRecord({
		version,
		task_id: taskId,
		task_description: taskDescription,
		child_session_id: childSessionId,
		parent_session_id: parentSessionId,
		launched_at_ms: launchedAtMs,
		updated_at_ms: updatedAtMs,
		completed_at_ms: completedAtMs,
		status,
		terminal_reason: terminalReason,
		concurrency_group: concurrencyGroup,
		last_progress_at_ms: lastProgressAtMs,
		idle_seen_at_ms: idleSeenAtMs,
		completion_attempts: completionAttempts,
		launch_error: launchError,
		launch_error_at_ms: launchErrorAtMs,
	});

	return normalized;
}

function coerceState(value: unknown, nowMs: number): BackgroundTaskState {
	if (
		!isRecord(value) ||
		(value.version !== 1 && value.version !== 2)
	) {
		return createDefaultState(nowMs);
	}

	const notifiedTaskIds: Record<string, number> = {};
	const rawNotified = isRecord(value.notifiedTaskIds)
		? value.notifiedTaskIds
		: {};
	for (const [taskId, atMs] of Object.entries(rawNotified)) {
		const parsedAtMs = asFiniteNumber(atMs);
		if (parsedAtMs == null) continue;
		notifiedTaskIds[taskId] = parsedAtMs;
	}

	const duplicateBySession: Record<string, SessionDuplicateRecord> = {};
	const rawDuplicateBySession = isRecord(value.duplicateBySession)
		? value.duplicateBySession
		: {};
	for (const [sessionId, record] of Object.entries(rawDuplicateBySession)) {
		if (!isRecord(record)) continue;
		const messageKey = asString(record.messageKey);
		const atMs = asFiniteNumber(record.atMs);
		if (!messageKey || atMs == null) continue;
		duplicateBySession[sessionId] = { messageKey, atMs };
	}

	const backgroundTasks: Record<string, BackgroundTaskRecord> = {};
	const rawBackgroundTasks = isRecord(value.backgroundTasks)
		? value.backgroundTasks
		: {};
	for (const [taskId, record] of Object.entries(rawBackgroundTasks)) {
		const parsed = coerceBackgroundTaskRecord(record);
		if (!parsed) continue;
		if (parsed.task_id !== taskId) continue;
		backgroundTasks[taskId] = parsed;
	}

	return {
		version: 2,
		updatedAtMs: asFiniteNumber(value.updatedAtMs) ?? nowMs,
		notifiedTaskIds,
		duplicateBySession,
		backgroundTasks,
	};
}

function createLockOwnerId(): string {
	return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildStaleLockPath(lockPath: string, ownerId: string): string {
	return `${lockPath}.stale.${ownerId}.${Date.now()}`;
}

function isStaleLockFile(lockFile: LockFile): boolean {
	return Date.now() - lockFile.createdAt > LOCK_STALE_MS;
}

async function readLockFile(lockPath: string): Promise<LockFile | null> {
	try {
		const raw = await fs.promises.readFile(lockPath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<LockFile>;
		if (typeof parsed.ownerId !== "string") return null;
		if (!Number.isFinite(parsed.createdAt)) return null;
		return {
			ownerId: parsed.ownerId,
			createdAt: Number(parsed.createdAt),
		};
	} catch (error) {
		if (isMissingFileError(error)) {
			return null;
		}
		throw error;
	}
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.promises.stat(filePath);
		return true;
	} catch (error) {
		if (isMissingFileError(error)) {
			return false;
		}
		throw error;
	}
}

async function maybeEvictStaleLock(
	lockPath: string,
	ownerId: string,
): Promise<void> {
	const lockFileBeforeRename = await readLockFile(lockPath);
	if (!lockFileBeforeRename) {
		return;
	}

	if (!isStaleLockFile(lockFileBeforeRename)) {
		return;
	}

	const stalePath = buildStaleLockPath(lockPath, ownerId);
	try {
		await fs.promises.rename(lockPath, stalePath);
	} catch (error) {
		if (
			isErrnoException(error) &&
			(error.code === "ENOENT" || error.code === "EEXIST")
		) {
			return;
		}
		throw error;
	}

	const lockFileAfterRename = await readLockFile(stalePath);
	if (lockFileAfterRename && isStaleLockFile(lockFileAfterRename)) {
		return;
	}

	if (!(await pathExists(lockPath))) {
		try {
			await fs.promises.rename(stalePath, lockPath);
		} catch (error) {
			if (isMissingFileError(error)) {
				return;
			}
			throw error;
		}
	}
}

async function acquireLock(lockPath: string): Promise<LockHandle> {
	const ownerId = createLockOwnerId();
	const lockPayload: LockFile = {
		ownerId,
		createdAt: Date.now(),
	};

	await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });

	for (let attempt = 0; attempt <= LOCK_MAX_RETRIES; attempt += 1) {
		try {
			const fileHandle = await fs.promises.open(lockPath, "wx");
			await fileHandle.writeFile(`${JSON.stringify(lockPayload)}\n`, "utf-8");
			await fileHandle.sync();
			return { fileHandle, ownerId };
		} catch (error) {
			if (!isErrnoException(error) || error.code !== "EEXIST") {
				throw error;
			}

			await maybeEvictStaleLock(lockPath, ownerId);

			if (attempt === LOCK_MAX_RETRIES) {
				throw new Error(
					`Failed to acquire background task state lock: ${lockPath}`,
				);
			}

			await sleep(lockRetryDelay(attempt));
		}
	}

	throw new Error(`Failed to acquire background task state lock: ${lockPath}`);
}

async function releaseLock(
	lockPath: string,
	lockHandle: LockHandle,
): Promise<void> {
	let closeError: unknown;

	try {
		await lockHandle.fileHandle.close();
	} catch (error) {
		closeError = error;
	}

	const lock = await readLockFile(lockPath);
	if (lock && lock.ownerId === lockHandle.ownerId) {
		try {
			await fs.promises.unlink(lockPath);
		} catch (error) {
			if (!isMissingFileError(error)) {
				throw error;
			}
		}
	}

	if (closeError) {
		throw closeError;
	}
}

async function withStateLock<T>(
	statePath: string,
	fn: () => Promise<T>,
): Promise<T> {
	const lockPath = `${statePath}.lock`;
	const lockHandle = await acquireLock(lockPath);
	try {
		return await fn();
	} finally {
		await releaseLock(lockPath, lockHandle);
	}
}

function createCorruptStatePath(statePath: string): string {
	return `${statePath}.corrupt.${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
}

async function archiveCorruptStateFile(statePath: string): Promise<void> {
	const corruptPath = createCorruptStatePath(statePath);
	try {
		await fs.promises.rename(statePath, corruptPath);
	} catch (error) {
		if (
			isErrnoException(error) &&
			(error.code === "ENOENT" || error.code === "EEXIST")
		) {
			return;
		}
		throw error;
	}
}

async function readState(
	statePath: string,
	nowMs: number,
): Promise<BackgroundTaskState> {
	let raw: string;
	try {
		raw = await fs.promises.readFile(statePath, "utf-8");
	} catch (error) {
		if (isMissingFileError(error)) {
			return createDefaultState(nowMs);
		}
		throw error;
	}

	try {
		return coerceState(JSON.parse(raw), nowMs);
	} catch {
		await archiveCorruptStateFile(statePath);
		return createDefaultState(nowMs);
	}
}

function createTempPath(statePath: string): string {
	return `${statePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function writeState(
	statePath: string,
	state: BackgroundTaskState,
): Promise<void> {
	const stateDir = path.dirname(statePath);
	await fs.promises.mkdir(stateDir, { recursive: true });

	const tempPath = createTempPath(statePath);
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
		} catch (cleanupError) {
			if (!isMissingFileError(cleanupError)) {
				throw cleanupError;
			}
		}
		throw error;
	}
}

function normalizeNowMs(nowMs?: number): number {
	if (Number.isFinite(nowMs)) {
		return Number(nowMs);
	}
	return Date.now();
}

function buildMessageKey(title: string, body: string): string {
	return `${title}\u0000${body}`;
}

function pruneDuplicateState(
	state: BackgroundTaskState,
	nowMs: number,
): void {
	for (const [sessionId, record] of Object.entries(state.duplicateBySession)) {
		if (nowMs - record.atMs >= DUPLICATE_WINDOW_MS) {
			delete state.duplicateBySession[sessionId];
		}
	}
}

function pruneNotifiedTaskIds(
	state: BackgroundTaskState,
	nowMs: number,
): void {
	for (const [taskId, notifiedAtMs] of Object.entries(state.notifiedTaskIds)) {
		if (
			nowMs >= notifiedAtMs &&
			nowMs - notifiedAtMs >= NOTIFIED_TASK_RETENTION_MS
		) {
			delete state.notifiedTaskIds[taskId];
		}
	}

	const entries = Object.entries(state.notifiedTaskIds);
	if (entries.length <= NOTIFIED_TASK_MAX_ENTRIES) {
		return;
	}

	const keepTaskIds = new Set(
		entries
			.sort((left, right) => right[1] - left[1])
			.slice(0, NOTIFIED_TASK_MAX_ENTRIES)
			.map(([taskId]) => taskId),
	);

	for (const taskId of Object.keys(state.notifiedTaskIds)) {
		if (!keepTaskIds.has(taskId)) {
			delete state.notifiedTaskIds[taskId];
		}
	}
}

function pruneBackgroundTasks(
	state: BackgroundTaskState,
	nowMs: number,
): void {
	for (const [taskId, record] of Object.entries(state.backgroundTasks)) {
		if (
			nowMs >= record.updated_at_ms &&
			nowMs - record.updated_at_ms >= BACKGROUND_TASK_RETENTION_MS
		) {
			delete state.backgroundTasks[taskId];
		}
	}

	const entries = Object.entries(state.backgroundTasks);
	if (entries.length <= BACKGROUND_TASK_MAX_ENTRIES) {
		return;
	}

	const keepTaskIds = new Set(
		entries
			.sort((left, right) => right[1].updated_at_ms - left[1].updated_at_ms)
			.slice(0, BACKGROUND_TASK_MAX_ENTRIES)
			.map(([taskId]) => taskId),
	);

	for (const taskId of Object.keys(state.backgroundTasks)) {
		if (!keepTaskIds.has(taskId)) {
			delete state.backgroundTasks[taskId];
		}
	}
}

function pruneState(state: BackgroundTaskState, nowMs: number): void {
	pruneDuplicateState(state, nowMs);
	pruneNotifiedTaskIds(state, nowMs);
	pruneBackgroundTasks(state, nowMs);
}

function normalizeTerminalMessage(message: string | undefined): string | undefined {
	const normalized = message?.trim();
	return normalized ? normalized : undefined;
}

function buildTerminalTaskRecord(args: {
	existing: BackgroundTaskRecord;
	reason: BackgroundTaskTerminalReason;
	terminalMessage?: string;
	nowMs: number;
}): BackgroundTaskRecord {
	const lifecycle = normalizeBackgroundTaskLifecycle(args.existing);
	const selectedReason = selectTerminalReasonByPrecedence({
		current: lifecycle.terminalReason,
		incoming: args.reason,
	});
	if (!selectedReason) {
		return canonicalizeBackgroundTaskRecord(args.existing);
	}

	const terminalWon = lifecycle.terminalReason !== selectedReason;
	const shouldAttachMessage =
		selectedReason !== "completed" && args.terminalMessage != null;

	return canonicalizeBackgroundTaskRecord({
		...args.existing,
		version: 2,
		status: selectedReason,
		terminal_reason: selectedReason,
		completed_at_ms:
			terminalWon || lifecycle.completedAtMs == null
				? args.nowMs
				: lifecycle.completedAtMs,
		updated_at_ms: args.nowMs,
		completion_attempts: (args.existing.completion_attempts ?? 0) + 1,
		last_progress_at_ms: args.nowMs,
		idle_seen_at_ms:
			selectedReason === "completed"
				? args.nowMs
				: args.existing.idle_seen_at_ms,
		launch_error: shouldAttachMessage
			? args.terminalMessage
			: args.existing.launch_error,
		launch_error_at_ms: shouldAttachMessage
			? args.nowMs
			: args.existing.launch_error_at_ms,
	});
}

async function markBackgroundTaskTerminal(args: {
	taskId: string;
	reason: BackgroundTaskTerminalReason;
	message?: string;
	nowMs?: number;
}): Promise<BackgroundTaskRecord | null> {
	const taskId = args.taskId.trim();
	if (!taskId) {
		return null;
	}

	const nowMs = normalizeNowMs(args.nowMs);
	const statePath = getBackgroundTaskStatePath();
	const terminalMessage = normalizeTerminalMessage(args.message);

	return withStateLock(statePath, async () => {
		const state = await readState(statePath, nowMs);
		pruneState(state, nowMs);

		const existing = state.backgroundTasks[taskId];
		if (!existing) {
			return null;
		}

		const updated = buildTerminalTaskRecord({
			existing,
			reason: args.reason,
			terminalMessage,
			nowMs,
		});

		state.backgroundTasks[taskId] = updated;
		state.updatedAtMs = nowMs;
		pruneState(state, nowMs);

		await writeState(statePath, state);
		return { ...updated };
	});
}

export async function markBackgroundTaskTerminalAtomic(
	args: MarkBackgroundTaskTerminalAtomicArgs,
): Promise<BackgroundTaskRecord | null> {
	const taskId = args.taskId.trim();
	if (!taskId) {
		return null;
	}

	const nowMs = normalizeNowMs(args.nowMs);
	const statePath = getBackgroundTaskStatePath();
	const terminalMessage = normalizeTerminalMessage(args.message);

	return withStateLock(statePath, async () => {
		const state = await readState(statePath, nowMs);
		pruneState(state, nowMs);

		if (state.notifiedTaskIds[taskId] != null) {
			return null;
		}

		const existing = state.backgroundTasks[taskId];
		if (!existing) {
			return null;
		}

		const updated = buildTerminalTaskRecord({
			existing,
			reason: args.reason,
			terminalMessage,
			nowMs,
		});

		state.backgroundTasks[taskId] = updated;
		state.notifiedTaskIds[taskId] = nowMs;
		state.updatedAtMs = nowMs;
		pruneState(state, nowMs);

		await writeState(statePath, state);
		return { ...updated };
	});
}

export async function markNotified(
	taskId: string,
	nowMs?: number,
): Promise<boolean> {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId) {
		return false;
	}

	const statePath = getBackgroundTaskStatePath();
	const atMs = normalizeNowMs(nowMs);

	return withStateLock(statePath, async () => {
		const state = await readState(statePath, atMs);
		pruneState(state, atMs);

		if (state.notifiedTaskIds[normalizedTaskId] != null) {
			return false;
		}

		state.notifiedTaskIds[normalizedTaskId] = atMs;
		state.updatedAtMs = atMs;
		pruneState(state, atMs);
		await writeState(statePath, state);
		return true;
	});
}

export async function shouldSuppressDuplicate(
	args: ShouldSuppressDuplicateArgs,
): Promise<boolean> {
	const sessionId = args.sessionId.trim();
	if (!sessionId) {
		return false;
	}

	const nowMs = normalizeNowMs(args.nowMs);
	const messageKey = buildMessageKey(args.title, args.body);
	const statePath = getBackgroundTaskStatePath();

	return withStateLock(statePath, async () => {
		const state = await readState(statePath, nowMs);
		pruneState(state, nowMs);

		const existing = state.duplicateBySession[sessionId];
		const shouldSuppress =
			existing != null &&
			existing.messageKey === messageKey &&
			nowMs >= existing.atMs &&
			nowMs - existing.atMs < DUPLICATE_WINDOW_MS;

		state.duplicateBySession[sessionId] = {
			messageKey,
			atMs: nowMs,
		};
		state.updatedAtMs = nowMs;
		pruneState(state, nowMs);
		await writeState(statePath, state);

		return shouldSuppress;
	});
}

export async function recordBackgroundTaskLaunch(
	args: RecordBackgroundTaskLaunchArgs,
): Promise<void> {
	const taskId = args.taskId.trim();
	const taskDescription = args.taskDescription?.trim();
	const childSessionId = args.childSessionId.trim();
	const parentSessionId = args.parentSessionId.trim();
	const requestedStatus = args.status;
	const concurrencyGroup = args.concurrencyGroup?.trim();
	if (!taskId || !childSessionId || !parentSessionId) {
		throw new Error(
			"recordBackgroundTaskLaunch requires taskId, childSessionId, and parentSessionId",
		);
	}

	if (
		requestedStatus !== undefined &&
		requestedStatus !== "queued" &&
		requestedStatus !== "running" &&
		requestedStatus !== "stable_idle"
	) {
		throw new Error(
			"recordBackgroundTaskLaunch status must be queued, running, or stable_idle",
		);
	}

	const nowMs = normalizeNowMs(args.nowMs);
	const statePath = getBackgroundTaskStatePath();

	await withStateLock(statePath, async () => {
		const state = await readState(statePath, nowMs);
		pruneState(state, nowMs);

		const existing = state.backgroundTasks[taskId];
		const existingLifecycle =
			existing != null ? normalizeBackgroundTaskLifecycle(existing) : null;
		const isTerminalReactivation = existingLifecycle?.isTerminal === true;

		let nextStatus: BackgroundTaskStatus = requestedStatus ?? "running";
		if (isTerminalReactivation) {
			// Explicit continuation on an existing public task_id is allowed to
			// reactivate the same canonical record. Terminal lifecycle fields are
			// cleared below when the new launch state is written.
		} else if (existingLifecycle) {
			if (existingLifecycle.status === "running" && nextStatus === "queued") {
				nextStatus = "running";
			}
			if (
				existingLifecycle.status === "stable_idle" &&
				nextStatus === "queued"
			) {
				nextStatus = "running";
			}
		}

		const nextRecord = canonicalizeBackgroundTaskRecord({
			version: 2,
			task_id: taskId,
			task_description: taskDescription || existing?.task_description,
			child_session_id: childSessionId,
			parent_session_id: parentSessionId,
			launched_at_ms: existing?.launched_at_ms ?? nowMs,
			updated_at_ms: nowMs,
			status: nextStatus,
			concurrency_group: concurrencyGroup || existing?.concurrency_group,
			last_progress_at_ms: nowMs,
			idle_seen_at_ms:
				nextStatus === "stable_idle"
					? nowMs
					: existingLifecycle?.status === "stable_idle"
						? existing?.idle_seen_at_ms
						: undefined,
			completion_attempts: existing?.completion_attempts ?? 0,
			completed_at_ms: undefined,
			terminal_reason: undefined,
			launch_error: undefined,
			launch_error_at_ms: undefined,
		});

		state.backgroundTasks[taskId] = nextRecord;
		state.updatedAtMs = nowMs;

		pruneState(state, nowMs);

		await writeState(statePath, state);
	});
}

export async function recordBackgroundTaskLaunchError(
	args: RecordBackgroundTaskLaunchErrorArgs,
): Promise<void> {
	const taskId = args.taskId.trim();
	const errorMessage = args.errorMessage.trim();
	if (!taskId || !errorMessage) {
		throw new Error(
			"recordBackgroundTaskLaunchError requires taskId and errorMessage",
		);
	}

	await markBackgroundTaskTerminal({
		taskId,
		reason: "failed",
		message: errorMessage,
		nowMs: args.nowMs,
	});
}

export async function findBackgroundTaskByChildSessionId(
	args: FindBackgroundTaskByChildSessionIdArgs,
): Promise<BackgroundTaskRecord | null> {
	const childSessionId = args.childSessionId.trim();
	if (!childSessionId) {
		return null;
	}

	const nowMs = normalizeNowMs(args.nowMs);
	const statePath = getBackgroundTaskStatePath();

	return withStateLock(statePath, async () => {
		const state = await readState(statePath, nowMs);
		pruneState(state, nowMs);

		for (const record of Object.values(state.backgroundTasks)) {
			if (record.child_session_id === childSessionId) {
				return { ...canonicalizeBackgroundTaskRecord(record) };
			}
		}

		return null;
	});
}

export async function findBackgroundTaskByTaskId(
	args: FindBackgroundTaskByTaskIdArgs,
): Promise<BackgroundTaskRecord | null> {
	const taskId = args.taskId.trim();
	if (!taskId) {
		return null;
	}

	const nowMs = normalizeNowMs(args.nowMs);
	const statePath = getBackgroundTaskStatePath();

	return withStateLock(statePath, async () => {
		const state = await readState(statePath, nowMs);
		pruneState(state, nowMs);

		const record = state.backgroundTasks[taskId];
		if (!record) {
			return null;
		}

		return { ...canonicalizeBackgroundTaskRecord(record) };
	});
}

export async function markBackgroundTaskCompleted(
	args: MarkBackgroundTaskCompletedArgs,
): Promise<BackgroundTaskRecord | null> {
	return markBackgroundTaskTerminal({
		taskId: args.taskId,
		reason: "completed",
		nowMs: args.nowMs,
	});
}

export async function markBackgroundTaskCancelled(
	args: MarkBackgroundTaskCancelledArgs,
): Promise<BackgroundTaskRecord | null> {
	const reason = (args.reason ?? "cancelled").trim() || "cancelled";
	return markBackgroundTaskTerminal({
		taskId: args.taskId,
		reason: "cancelled",
		message: reason,
		nowMs: args.nowMs,
	});
}

export async function markBackgroundTaskFailed(
	args: MarkBackgroundTaskFailedArgs,
): Promise<BackgroundTaskRecord | null> {
	const errorMessage = args.errorMessage.trim();
	if (!errorMessage) {
		throw new Error("markBackgroundTaskFailed requires errorMessage");
	}

	return markBackgroundTaskTerminal({
		taskId: args.taskId,
		reason: "failed",
		message: errorMessage,
		nowMs: args.nowMs,
	});
}

export async function markBackgroundTaskStale(
	args: MarkBackgroundTaskStaleArgs,
): Promise<BackgroundTaskRecord | null> {
	const reason =
		(args.reason ?? "No progress observed before stale timeout").trim() ||
		"No progress observed before stale timeout";

	return markBackgroundTaskTerminal({
		taskId: args.taskId,
		reason: "stale",
		message: reason,
		nowMs: args.nowMs,
	});
}

export async function recordBackgroundTaskObservation(
	args: RecordBackgroundTaskObservationArgs,
): Promise<BackgroundTaskRecord | null> {
	const taskId = args.taskId.trim();
	if (!taskId) {
		return null;
	}

	const nowMs = normalizeNowMs(args.nowMs);
	const statePath = getBackgroundTaskStatePath();

	return withStateLock(statePath, async () => {
		const state = await readState(statePath, nowMs);
		pruneState(state, nowMs);

		const existing = state.backgroundTasks[taskId];
		if (!existing) {
			return null;
		}

		const lifecycle = normalizeBackgroundTaskLifecycle(existing);
		if (lifecycle.isTerminal) {
			return { ...canonicalizeBackgroundTaskRecord(existing) };
		}

		const baselineLastProgressAtMs =
			existing.last_progress_at_ms ??
			existing.updated_at_ms ??
			existing.launched_at_ms;
		const observedIdle = args.status === "idle";
		const updated = canonicalizeBackgroundTaskRecord({
			...existing,
			version: 2,
			status: observedIdle ? "stable_idle" : "running",
			updated_at_ms: nowMs,
			last_progress_at_ms: observedIdle ? baselineLastProgressAtMs : nowMs,
			idle_seen_at_ms: observedIdle
				? existing.idle_seen_at_ms ?? nowMs
				: undefined,
		});

		state.backgroundTasks[taskId] = updated;
		state.updatedAtMs = nowMs;
		pruneState(state, nowMs);

		await writeState(statePath, state);
		return { ...updated };
	});
}

export async function listActiveBackgroundTasks(args?: {
	nowMs?: number;
}): Promise<BackgroundTaskRecord[]> {
	const nowMs = normalizeNowMs(args?.nowMs);
	const statePath = getBackgroundTaskStatePath();

	return withStateLock(statePath, async () => {
		const state = await readState(statePath, nowMs);
		pruneState(state, nowMs);

		return Object.values(state.backgroundTasks)
			.filter((record) => isBackgroundTaskActive(record))
			.map((record) => ({ ...canonicalizeBackgroundTaskRecord(record) }));
	});
}

export async function listBackgroundTasksByParent(args: {
	parentSessionId: string;
	nowMs?: number;
}): Promise<BackgroundTaskRecord[]> {
	const parentSessionId = args.parentSessionId.trim();
	if (!parentSessionId) {
		return [];
	}

	const nowMs = normalizeNowMs(args.nowMs);
	const statePath = getBackgroundTaskStatePath();

	return withStateLock(statePath, async () => {
		const state = await readState(statePath, nowMs);
		pruneState(state, nowMs);

		return Object.values(state.backgroundTasks)
			.filter((record) => record.parent_session_id === parentSessionId)
			.sort((left, right) => left.launched_at_ms - right.launched_at_ms)
			.map((record) => ({ ...canonicalizeBackgroundTaskRecord(record) }));
	});
}
