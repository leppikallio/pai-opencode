export type BackgroundConcurrencyLease = {
	group: string;
	taskId?: string;
	release: () => boolean;
	isReleased: () => boolean;
};

export type BackgroundConcurrencySnapshot = {
	group: string;
	limit: number;
	active: number;
	queued: number;
};

export type BackgroundConcurrencyManagerConfig = {
	defaultLimit: number;
	maxQueuePerGroup: number;
	groupLimitOverrides: Record<string, number>;
	debug: boolean;
	onDebug?: (event: {
		type:
			| "acquire.immediate"
			| "acquire.queued"
			| "acquire.granted"
			| "acquire.cancelled"
			| "acquire.saturated"
			| "release"
			| "release.duplicate";
		group: string;
		taskId?: string;
		active: number;
		queued: number;
		limit: number;
	}) => void;
};

export type AcquireBackgroundConcurrencyArgs = {
	group: string;
	taskId?: string;
	signal?: AbortSignal;
};

type Waiter = {
	group: string;
	taskId?: string;
	resolve: (lease: BackgroundConcurrencyLease) => void;
	reject: (error: Error) => void;
	signal?: AbortSignal;
	onAbort?: () => void;
	cancelled: boolean;
};

type GroupState = {
	active: number;
	queue: Waiter[];
	activeLeaseTokens: Set<number>;
};

const DEFAULT_LIMIT = 2;
const DEFAULT_MAX_QUEUE_PER_GROUP = 32;

const DEFAULT_CONFIG: BackgroundConcurrencyManagerConfig = {
	defaultLimit: DEFAULT_LIMIT,
	maxQueuePerGroup: DEFAULT_MAX_QUEUE_PER_GROUP,
	groupLimitOverrides: {},
	debug: false,
};

function normalizePositiveInt(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		const floored = Math.floor(value);
		if (floored > 0) {
			return floored;
		}
		return undefined;
	}

	if (typeof value === "string") {
		const parsed = Number.parseInt(value.trim(), 10);
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
	}

	return undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}

	if (
		normalized === "1" ||
		normalized === "true" ||
		normalized === "yes" ||
		normalized === "on"
	) {
		return true;
	}

	if (
		normalized === "0" ||
		normalized === "false" ||
		normalized === "no" ||
		normalized === "off"
	) {
		return false;
	}

	return undefined;
}

function normalizeGroupToken(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._:/-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-/:]+|[-/:]+$/g, "");
}

export function normalizeConcurrencyGroup(group: string): string {
	const normalized = normalizeGroupToken(group);
	if (!normalized) {
		return "agent:general";
	}

	return normalized.includes(":") ? normalized : `agent:${normalized}`;
}

function parseOverridesFromEnv(raw: string | undefined): Record<string, number> {
	if (!raw || !raw.trim()) {
		return {};
	}

	const trimmed = raw.trim();
	if (trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed) as Record<string, unknown>;
			const out: Record<string, number> = {};
			for (const [group, limit] of Object.entries(parsed)) {
				const normalizedGroup = normalizeConcurrencyGroup(group);
				const normalizedLimit = normalizePositiveInt(limit);
				if (normalizedGroup && normalizedLimit) {
					out[normalizedGroup] = normalizedLimit;
				}
			}
			return out;
		} catch {
			return {};
		}
	}

	const out: Record<string, number> = {};
	for (const chunk of trimmed.split(",")) {
		const [groupRaw, limitRaw] = chunk.split("=");
		if (!groupRaw || !limitRaw) {
			continue;
		}

		const group = normalizeConcurrencyGroup(groupRaw);
		const limit = normalizePositiveInt(limitRaw);
		if (group && limit) {
			out[group] = limit;
		}
	}

	return out;
}

export function resolveBackgroundConcurrencyManagerConfig(
	env: Readonly<Record<string, string | undefined>> = process.env,
): BackgroundConcurrencyManagerConfig {
	const defaultLimit =
		normalizePositiveInt(env.PAI_BACKGROUND_CONCURRENCY_LIMIT_DEFAULT) ??
		DEFAULT_LIMIT;
	const maxQueuePerGroup =
		normalizePositiveInt(env.PAI_BACKGROUND_CONCURRENCY_MAX_QUEUE) ??
		DEFAULT_MAX_QUEUE_PER_GROUP;
	const groupLimitOverrides = parseOverridesFromEnv(
		env.PAI_BACKGROUND_CONCURRENCY_LIMIT_OVERRIDES,
	);
	const debug = normalizeBoolean(env.PAI_BACKGROUND_CONCURRENCY_DEBUG) ?? false;

	return {
		defaultLimit,
		maxQueuePerGroup,
		groupLimitOverrides,
		debug,
	};
}

export function deriveBackgroundConcurrencyGroup(args: {
	providerId?: string;
	modelId?: string;
	subagentType?: string;
}): string {
	const provider = args.providerId
		? normalizeGroupToken(args.providerId)
		: "";
	const model = args.modelId ? normalizeGroupToken(args.modelId) : "";
	const agent = args.subagentType ? normalizeGroupToken(args.subagentType) : "";

	if (provider && model) {
		return normalizeConcurrencyGroup(`model:${provider}/${model}`);
	}

	if (model) {
		return normalizeConcurrencyGroup(`model:${model}`);
	}

	if (agent) {
		return normalizeConcurrencyGroup(`agent:${agent}`);
	}

	return "agent:general";
}

export class BackgroundConcurrencySaturationError extends Error {
	readonly group: string;

	constructor(group: string) {
		super(`Background concurrency queue saturated for group: ${group}`);
		this.name = "BackgroundConcurrencySaturationError";
		this.group = group;
	}
}

export class BackgroundConcurrencyCancelledError extends Error {
	readonly group: string;

	constructor(group: string) {
		super(`Background concurrency acquire cancelled for group: ${group}`);
		this.name = "BackgroundConcurrencyCancelledError";
		this.group = group;
	}
}

export class BackgroundConcurrencyManager {
	private readonly config: BackgroundConcurrencyManagerConfig;
	private readonly groups = new Map<string, GroupState>();
	private leaseCounter = 0;

	constructor(config?: Partial<BackgroundConcurrencyManagerConfig>) {
		this.config = {
			...DEFAULT_CONFIG,
			...config,
			groupLimitOverrides: {
				...DEFAULT_CONFIG.groupLimitOverrides,
				...(config?.groupLimitOverrides ?? {}),
			},
			defaultLimit: Math.max(1, config?.defaultLimit ?? DEFAULT_LIMIT),
			maxQueuePerGroup: Math.max(
				1,
				config?.maxQueuePerGroup ?? DEFAULT_MAX_QUEUE_PER_GROUP,
			),
		};
	}

	private getGroupState(group: string): GroupState {
		let state = this.groups.get(group);
		if (!state) {
			state = {
				active: 0,
				queue: [],
				activeLeaseTokens: new Set<number>(),
			};
			this.groups.set(group, state);
		}

		return state;
	}

	private getLimit(group: string): number {
		const override = this.config.groupLimitOverrides[group];
		if (typeof override === "number" && Number.isFinite(override) && override > 0) {
			return Math.floor(override);
		}

		return this.config.defaultLimit;
	}

	private emitDebug(event: {
		type:
			| "acquire.immediate"
			| "acquire.queued"
			| "acquire.granted"
			| "acquire.cancelled"
			| "acquire.saturated"
			| "release"
			| "release.duplicate";
		group: string;
		taskId?: string;
		active: number;
		queued: number;
		limit: number;
	}): void {
		if (!this.config.debug && !this.config.onDebug) {
			return;
		}

		this.config.onDebug?.(event);

		if (this.config.debug && process.env.PAI_CC_HOOKS_DEBUG === "1") {
			console.warn(
				`[pai-cc-hooks] concurrency ${event.type} group=${event.group} task=${event.taskId ?? "-"} active=${event.active} queued=${event.queued} limit=${event.limit}`,
			);
		}
	}

	private createLease(group: string, taskId?: string): BackgroundConcurrencyLease {
		const leaseToken = ++this.leaseCounter;
		const state = this.getGroupState(group);
		state.active += 1;
		state.activeLeaseTokens.add(leaseToken);

		let released = false;
		return {
			group,
			taskId,
			release: () => {
				if (released) {
					this.emitDebug({
						type: "release.duplicate",
						group,
						taskId,
						active: state.active,
						queued: state.queue.length,
						limit: this.getLimit(group),
					});
					return false;
				}

				released = true;
				const activeState = this.getGroupState(group);
				if (!activeState.activeLeaseTokens.delete(leaseToken)) {
					this.emitDebug({
						type: "release.duplicate",
						group,
						taskId,
						active: activeState.active,
						queued: activeState.queue.length,
						limit: this.getLimit(group),
					});
					return false;
				}

				if (activeState.active > 0) {
					activeState.active -= 1;
				}

				this.emitDebug({
					type: "release",
					group,
					taskId,
					active: activeState.active,
					queued: activeState.queue.length,
					limit: this.getLimit(group),
				});

				this.drainQueue(group, activeState);
				return true;
			},
			isReleased: () => released,
		};
	}

	private detachAbort(waiter: Waiter): void {
		if (waiter.signal && waiter.onAbort) {
			waiter.signal.removeEventListener("abort", waiter.onAbort);
			waiter.onAbort = undefined;
		}
	}

	private drainQueue(group: string, state: GroupState): void {
		const limit = this.getLimit(group);
		while (state.active < limit && state.queue.length > 0) {
			const waiter = state.queue.shift();
			if (!waiter || waiter.cancelled) {
				continue;
			}

			if (waiter.signal?.aborted) {
				waiter.cancelled = true;
				this.detachAbort(waiter);
				waiter.reject(new BackgroundConcurrencyCancelledError(group));
				this.emitDebug({
					type: "acquire.cancelled",
					group,
					taskId: waiter.taskId,
					active: state.active,
					queued: state.queue.length,
					limit,
				});
				continue;
			}

			this.detachAbort(waiter);
			const lease = this.createLease(group, waiter.taskId);
			waiter.resolve(lease);
			this.emitDebug({
				type: "acquire.granted",
				group,
				taskId: waiter.taskId,
				active: this.getGroupState(group).active,
				queued: this.getGroupState(group).queue.length,
				limit,
			});
		}
	}

	async acquire(
		args: AcquireBackgroundConcurrencyArgs,
	): Promise<BackgroundConcurrencyLease> {
		const group = normalizeConcurrencyGroup(args.group);
		const state = this.getGroupState(group);
		const limit = this.getLimit(group);

		this.drainQueue(group, state);

		if (state.queue.length === 0 && state.active < limit) {
			const lease = this.createLease(group, args.taskId);
			this.emitDebug({
				type: "acquire.immediate",
				group,
				taskId: args.taskId,
				active: this.getGroupState(group).active,
				queued: this.getGroupState(group).queue.length,
				limit,
			});
			return lease;
		}

		if (state.queue.length >= this.config.maxQueuePerGroup) {
			this.emitDebug({
				type: "acquire.saturated",
				group,
				taskId: args.taskId,
				active: state.active,
				queued: state.queue.length,
				limit,
			});
			throw new BackgroundConcurrencySaturationError(group);
		}

		return new Promise<BackgroundConcurrencyLease>((resolve, reject) => {
			if (args.signal?.aborted) {
				reject(new BackgroundConcurrencyCancelledError(group));
				return;
			}

			const waiter: Waiter = {
				group,
				taskId: args.taskId,
				resolve,
				reject,
				signal: args.signal,
				cancelled: false,
			};

			if (args.signal) {
				waiter.onAbort = () => {
					if (waiter.cancelled) {
						return;
					}

					waiter.cancelled = true;
					const groupState = this.getGroupState(group);
					groupState.queue = groupState.queue.filter((queued) => queued !== waiter);
					this.detachAbort(waiter);
					reject(new BackgroundConcurrencyCancelledError(group));
					this.emitDebug({
						type: "acquire.cancelled",
						group,
						taskId: waiter.taskId,
						active: groupState.active,
						queued: groupState.queue.length,
						limit: this.getLimit(group),
					});
				};
				args.signal.addEventListener("abort", waiter.onAbort, { once: true });
			}

			state.queue.push(waiter);
			this.emitDebug({
				type: "acquire.queued",
				group,
				taskId: waiter.taskId,
				active: state.active,
				queued: state.queue.length,
				limit,
			});
		});
	}

	cancelPendingTask(taskId: string, group?: string): boolean {
		const normalizedTaskId = taskId.trim();
		if (!normalizedTaskId) {
			return false;
		}

		const groupsToInspect = group
			? [normalizeConcurrencyGroup(group)]
			: Array.from(this.groups.keys());

		for (const groupKey of groupsToInspect) {
			const state = this.groups.get(groupKey);
			if (!state || state.queue.length === 0) {
				continue;
			}

			const idx = state.queue.findIndex(
				(waiter) => waiter.taskId === normalizedTaskId,
			);
			if (idx === -1) {
				continue;
			}

			const [waiter] = state.queue.splice(idx, 1);
			if (!waiter) {
				return false;
			}

			waiter.cancelled = true;
			this.detachAbort(waiter);
			waiter.reject(new BackgroundConcurrencyCancelledError(groupKey));
			this.emitDebug({
				type: "acquire.cancelled",
				group: groupKey,
				taskId: waiter.taskId,
				active: state.active,
				queued: state.queue.length,
				limit: this.getLimit(groupKey),
			});
			return true;
		}

		return false;
	}

	getSnapshot(group?: string): BackgroundConcurrencySnapshot[] {
		if (group) {
			const normalizedGroup = normalizeConcurrencyGroup(group);
			const state = this.getGroupState(normalizedGroup);
			return [
				{
					group: normalizedGroup,
					limit: this.getLimit(normalizedGroup),
					active: state.active,
					queued: state.queue.length,
				},
			];
		}

		return Array.from(this.groups.entries()).map(([groupKey, state]) => ({
			group: groupKey,
			limit: this.getLimit(groupKey),
			active: state.active,
			queued: state.queue.length,
		}));
	}
}

let singletonManager: BackgroundConcurrencyManager | null = null;

export function getBackgroundConcurrencyManager(
	env: Readonly<Record<string, string | undefined>> = process.env,
): BackgroundConcurrencyManager {
	if (!singletonManager) {
		singletonManager = new BackgroundConcurrencyManager(
			resolveBackgroundConcurrencyManagerConfig(env),
		);
	}

	return singletonManager;
}

export function __resetBackgroundConcurrencyManagerForTests(): void {
	singletonManager = null;
}
