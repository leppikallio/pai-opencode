import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type RunLockRecord = {
	pid: number;
	hostname: string;
	created_at: string;
	lease_seconds: number;
	refreshed_at: string;
	owner_id: string;
	reason?: string;
};

export type RunLockHandle = {
	run_root: string;
	lock_path: string;
	owner_id: string;
};

type RunLockFailure = {
	ok: false;
	code: string;
	message: string;
	details: Record<string, unknown>;
};

type RunLockAcquireSuccess = {
	ok: true;
	handle: RunLockHandle;
	lock: RunLockRecord;
};

type RunLockRefreshSuccess = {
	ok: true;
	lock: RunLockRecord;
};

type RunLockReleaseSuccess = {
	ok: true;
	released: boolean;
};

type RunLockReadSuccess = {
	ok: true;
	lock_path: string;
	lock: RunLockRecord | null;
	stale: boolean;
};

function lockPathForRunRoot(runRoot: string): string {
	return path.join(runRoot, ".lock");
}

function parseDateMillis(value: unknown): number | null {
	if (typeof value !== "string" || !value.trim()) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

function normalizeRunLockRecord(value: unknown): RunLockRecord | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const obj = value as Record<string, unknown>;
	if (typeof obj.pid !== "number" || !Number.isFinite(obj.pid)) return null;
	if (typeof obj.hostname !== "string" || !obj.hostname.trim()) return null;
	if (typeof obj.created_at !== "string" || !obj.created_at.trim()) return null;
	if (
		typeof obj.lease_seconds !== "number" ||
		!Number.isFinite(obj.lease_seconds) ||
		obj.lease_seconds <= 0
	)
		return null;
	if (typeof obj.refreshed_at !== "string" || !obj.refreshed_at.trim())
		return null;
	if (typeof obj.owner_id !== "string" || !obj.owner_id.trim()) return null;

	const out: RunLockRecord = {
		pid: obj.pid,
		hostname: obj.hostname,
		created_at: obj.created_at,
		lease_seconds: Math.trunc(obj.lease_seconds),
		refreshed_at: obj.refreshed_at,
		owner_id: obj.owner_id,
	};

	if (typeof obj.reason === "string" && obj.reason.trim()) {
		out.reason = obj.reason.trim();
	}

	return out;
}

function runLockFailure(
	code: string,
	message: string,
	details: Record<string, unknown> = {},
): RunLockFailure {
	return { ok: false, code, message, details };
}

async function readRunLockFile(
	lockPath: string,
): Promise<RunLockRecord | null> {
	const raw = await fs.promises.readFile(lockPath, "utf8");
	const parsed = JSON.parse(raw);
	return normalizeRunLockRecord(parsed);
}

function createLockRecord(args: {
	lease_seconds: number;
	reason?: string;
}): RunLockRecord {
	const nowIso = new Date().toISOString();
	const hostname = os.hostname();
	const pidRaw = (globalThis as { process?: { pid?: unknown } }).process?.pid;
	const pid =
		typeof pidRaw === "number" && Number.isFinite(pidRaw)
			? Math.trunc(pidRaw)
			: -1;
	const ownerId = `${hostname}:${pid}:${nowIso}`;

	return {
		pid,
		hostname,
		created_at: nowIso,
		lease_seconds: Math.trunc(args.lease_seconds),
		refreshed_at: nowIso,
		owner_id: ownerId,
		reason: args.reason,
	};
}

export function isRunLockStale(lock: RunLockRecord, nowIso?: string): boolean {
	const nowMs = nowIso ? Date.parse(nowIso) : Date.now();
	if (!Number.isFinite(nowMs)) return true;
	const leaseMs = Math.max(0, Math.trunc(lock.lease_seconds)) * 1000;
	if (leaseMs <= 0) return true;

	const heartbeatMs =
		parseDateMillis(lock.refreshed_at) ?? parseDateMillis(lock.created_at);
	if (heartbeatMs === null) return true;
	return nowMs > heartbeatMs + leaseMs;
}

export async function detectRunLock(args: {
	run_root: string;
	now_iso?: string;
}): Promise<RunLockReadSuccess | RunLockFailure> {
	const runRoot = args.run_root.trim();
	if (!runRoot || !path.isAbsolute(runRoot)) {
		return runLockFailure("INVALID_ARGS", "run_root must be absolute", {
			run_root: args.run_root,
		});
	}

	const lockPath = lockPathForRunRoot(runRoot);
	try {
		const lock = await readRunLockFile(lockPath);
		if (!lock) {
			return runLockFailure("LOCK_PARSE_FAILED", "lock file is invalid", {
				lock_path: lockPath,
			});
		}
		return {
			ok: true,
			lock_path: lockPath,
			lock,
			stale: isRunLockStale(lock, args.now_iso),
		};
	} catch (e) {
		const code = (e as { code?: unknown }).code;
		if (code === "ENOENT") {
			return {
				ok: true,
				lock_path: lockPath,
				lock: null,
				stale: false,
			};
		}
		return runLockFailure("LOCK_READ_FAILED", "failed to read lock file", {
			lock_path: lockPath,
			message: String(e),
		});
	}
}

export async function acquireRunLock(args: {
	run_root: string;
	lease_seconds: number;
	reason?: string;
}): Promise<RunLockAcquireSuccess | RunLockFailure> {
	const runRoot = args.run_root.trim();
	const leaseSeconds = Math.trunc(args.lease_seconds);
	const reason = args.reason?.trim();

	if (!runRoot || !path.isAbsolute(runRoot)) {
		return runLockFailure("INVALID_ARGS", "run_root must be absolute", {
			run_root: args.run_root,
		});
	}
	if (!Number.isFinite(leaseSeconds) || leaseSeconds <= 0) {
		return runLockFailure("INVALID_ARGS", "lease_seconds must be > 0", {
			lease_seconds: args.lease_seconds,
		});
	}

	const lockPath = lockPathForRunRoot(runRoot);
	const createAndWrite = async (): Promise<RunLockRecord> => {
		const lock = createLockRecord({ lease_seconds: leaseSeconds, reason });
		await fs.promises.mkdir(runRoot, { recursive: true });
		await fs.promises.writeFile(
			lockPath,
			`${JSON.stringify(lock, null, 2)}\n`,
			{ encoding: "utf8", flag: "wx" },
		);
		return lock;
	};

	try {
		const lock = await createAndWrite();
		return {
			ok: true,
			lock,
			handle: {
				run_root: runRoot,
				lock_path: lockPath,
				owner_id: lock.owner_id,
			},
		};
	} catch (e) {
		const code = (e as { code?: unknown }).code;
		if (code !== "EEXIST") {
			return runLockFailure("LOCK_WRITE_FAILED", "failed to create run lock", {
				lock_path: lockPath,
				message: String(e),
			});
		}
	}

	let existingLock: RunLockRecord | null = null;
	try {
		existingLock = await readRunLockFile(lockPath);
	} catch (e) {
		return runLockFailure(
			"LOCK_READ_FAILED",
			"failed to read existing run lock",
			{
				lock_path: lockPath,
				message: String(e),
			},
		);
	}

	if (!existingLock || !isRunLockStale(existingLock)) {
		return runLockFailure("LOCK_HELD", "run lock is already held", {
			lock_path: lockPath,
			lock: existingLock,
			stale: false,
		});
	}

	try {
		await fs.promises.rm(lockPath, { force: true });
	} catch (e) {
		return runLockFailure(
			"LOCK_RELEASE_FAILED",
			"failed to remove stale lock",
			{
				lock_path: lockPath,
				message: String(e),
				stale_lock: existingLock,
			},
		);
	}

	try {
		const lock = await createAndWrite();
		return {
			ok: true,
			lock,
			handle: {
				run_root: runRoot,
				lock_path: lockPath,
				owner_id: lock.owner_id,
			},
		};
	} catch (e) {
		return runLockFailure("LOCK_HELD", "run lock is already held", {
			lock_path: lockPath,
			message: String(e),
		});
	}
}

export async function refreshRunLock(args: {
	handle: RunLockHandle;
	lease_seconds?: number;
}): Promise<RunLockRefreshSuccess | RunLockFailure> {
	const lockPath = args.handle.lock_path;
	const nextLeaseSeconds =
		args.lease_seconds === undefined ? null : Math.trunc(args.lease_seconds);

	let current: RunLockRecord;
	try {
		const loaded = await readRunLockFile(lockPath);
		if (!loaded) {
			return runLockFailure("LOCK_PARSE_FAILED", "lock file is invalid", {
				lock_path: lockPath,
			});
		}
		current = loaded;
	} catch (e) {
		const code = (e as { code?: unknown }).code;
		if (code === "ENOENT") {
			return runLockFailure("LOCK_NOT_HELD", "run lock does not exist", {
				lock_path: lockPath,
			});
		}
		return runLockFailure("LOCK_READ_FAILED", "failed to read lock file", {
			lock_path: lockPath,
			message: String(e),
		});
	}

	if (current.owner_id !== args.handle.owner_id) {
		return runLockFailure(
			"LOCK_NOT_OWNED",
			"run lock is owned by another process",
			{
				lock_path: lockPath,
				owner_id: current.owner_id,
				expected_owner_id: args.handle.owner_id,
			},
		);
	}

	if (
		nextLeaseSeconds !== null &&
		(!Number.isFinite(nextLeaseSeconds) || nextLeaseSeconds <= 0)
	) {
		return runLockFailure("INVALID_ARGS", "lease_seconds must be > 0", {
			lease_seconds: args.lease_seconds,
		});
	}

	const refreshed: RunLockRecord = {
		...current,
		lease_seconds: nextLeaseSeconds ?? current.lease_seconds,
		refreshed_at: new Date().toISOString(),
	};

	try {
		await fs.promises.writeFile(
			lockPath,
			`${JSON.stringify(refreshed, null, 2)}\n`,
			"utf8",
		);
	} catch (e) {
		return runLockFailure("LOCK_WRITE_FAILED", "failed to refresh lock file", {
			lock_path: lockPath,
			message: String(e),
		});
	}

	return {
		ok: true,
		lock: refreshed,
	};
}

export function startRunLockHeartbeat(args: {
	handle: RunLockHandle;
	interval_ms?: number;
	lease_seconds?: number;
}): { stop: () => void } {
	const intervalMsRaw =
		typeof args.interval_ms === "number" && Number.isFinite(args.interval_ms)
			? Math.trunc(args.interval_ms)
			: 30_000;
	const intervalMs = Math.max(250, intervalMsRaw);

	let stopped = false;
	const timer = setInterval(() => {
		if (stopped) return;
		void refreshRunLock({
			handle: args.handle,
			lease_seconds: args.lease_seconds,
		}).then(() => undefined, () => undefined);
	}, intervalMs);
	// Avoid keeping the process alive just for the heartbeat.
	(timer as unknown as { unref?: () => void }).unref?.();

	return {
		stop: () => {
			stopped = true;
			clearInterval(timer);
		},
	};
}

export async function releaseRunLock(
	handle: RunLockHandle,
): Promise<RunLockReleaseSuccess | RunLockFailure> {
	const lockPath = handle.lock_path;

	let current: RunLockRecord | null = null;
	try {
		current = await readRunLockFile(lockPath);
	} catch (e) {
		const code = (e as { code?: unknown }).code;
		if (code === "ENOENT") {
			return { ok: true, released: false };
		}
		return runLockFailure("LOCK_READ_FAILED", "failed to read lock file", {
			lock_path: lockPath,
			message: String(e),
		});
	}

	if (!current) {
		return runLockFailure("LOCK_PARSE_FAILED", "lock file is invalid", {
			lock_path: lockPath,
		});
	}

	if (current.owner_id !== handle.owner_id) {
		return runLockFailure(
			"LOCK_NOT_OWNED",
			"run lock is owned by another process",
			{
				lock_path: lockPath,
				owner_id: current.owner_id,
				expected_owner_id: handle.owner_id,
			},
		);
	}

	try {
		await fs.promises.rm(lockPath, { force: true });
	} catch (e) {
		return runLockFailure("LOCK_RELEASE_FAILED", "failed to release run lock", {
			lock_path: lockPath,
			message: String(e),
		});
	}

	return {
		ok: true,
		released: true,
	};
}
