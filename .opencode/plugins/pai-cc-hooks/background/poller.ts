import type { BackgroundTaskRecord } from "../tools/background-task-state";

type CarrierClient = {
  session?: {
    status?: (options?: unknown) => Promise<unknown>;
  };
};

type StatusMap = Record<string, { type?: string }>

type PollerDeps = {
  client: unknown;
  listActiveBackgroundTasks: (args?: { nowMs?: number }) => Promise<BackgroundTaskRecord[]>;
  markNotified: (taskId: string, nowMs?: number) => Promise<boolean>;
  markBackgroundTaskCompleted: (args: { taskId: string; nowMs?: number }) => Promise<BackgroundTaskRecord | null>;
  onTaskCompleted?: (record: BackgroundTaskRecord) => Promise<void>;
  pollIntervalMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getAnyProp(obj: unknown, key: string): unknown {
  return isRecord(obj) ? obj[key] : undefined;
}

function normalizeStatusMap(result: unknown): StatusMap {
  const data = getAnyProp(result, "data");
  if (isRecord(data)) {
    return Object.fromEntries(
      Object.entries(data).map(([sessionId, status]) => {
        return [sessionId, isRecord(status) ? status : {}];
      }),
    );
  }
  if (isRecord(result)) {
    return Object.fromEntries(
      Object.entries(result).map(([sessionId, status]) => {
        return [sessionId, isRecord(status) ? status : {}];
      }),
    );
  }
  return {};
}

export class BackgroundTaskPoller {
  private readonly client: CarrierClient;
  private readonly listActiveBackgroundTasks: PollerDeps["listActiveBackgroundTasks"];
  private readonly markNotified: PollerDeps["markNotified"];
  private readonly markBackgroundTaskCompleted: PollerDeps["markBackgroundTaskCompleted"];
  private readonly onTaskCompleted: PollerDeps["onTaskCompleted"];
  private readonly pollIntervalMs: number;
  private pollingInFlight = false;
  private pollingInterval?: ReturnType<typeof setInterval>;

  constructor(deps: PollerDeps) {
    this.client = (deps.client ?? {}) as CarrierClient;
    this.listActiveBackgroundTasks = deps.listActiveBackgroundTasks;
    this.markNotified = deps.markNotified;
    this.markBackgroundTaskCompleted = deps.markBackgroundTaskCompleted;
    this.onTaskCompleted = deps.onTaskCompleted;
    this.pollIntervalMs = Math.max(250, Math.min(deps.pollIntervalMs ?? 1500, 60_000));
  }

  start(): void {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
    this.pollingInterval.unref?.();
  }

  stop(): void {
    if (!this.pollingInterval) return;
    clearInterval(this.pollingInterval);
    this.pollingInterval = undefined;
  }

  async pollOnce(): Promise<void> {
    if (this.pollingInFlight) return;
    this.pollingInFlight = true;
    try {
      const session = this.client.session;
      if (typeof session?.status !== "function") {
        return;
      }

      const active = await this.listActiveBackgroundTasks();
      if (active.length === 0) {
        return;
      }

      const statusResult = await session.status();
      const statuses = normalizeStatusMap(statusResult);

      for (const record of active) {
        try {
          const status = statuses[record.child_session_id];
          if (!status || status.type !== "idle") continue;

          const shouldNotify = await this.markNotified(record.task_id);
          if (!shouldNotify) continue;

          const completed = await this.markBackgroundTaskCompleted({ taskId: record.task_id });
          if (!completed) continue;

          await this.onTaskCompleted?.(completed);
        } catch {
          // Safety guard: never let one task failure break polling for other tasks.
          continue;
        }
      }
    } finally {
      this.pollingInFlight = false;
    }
  }
}
