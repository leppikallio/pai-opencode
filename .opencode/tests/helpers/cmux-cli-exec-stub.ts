export type CmuxCliExecRequest = {
  bin: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
};

export type CmuxCliExecResponse = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
};

export type CmuxCliExec = (req: CmuxCliExecRequest) => Promise<CmuxCliExecResponse>;

export type QueuedCmuxCliExecStubOptions = {
  /** What to do when the queue is empty. Default keeps tests backward-compatible. */
  onEmpty?: "success" | "throw";
  /** Record requests as immutable snapshots (recommended). */
  recordCallSnapshots?: boolean;
};

export function createQueuedCmuxCliExecStub(
  queue: Array<CmuxCliExecResponse | Error>,
  options: QueuedCmuxCliExecStubOptions = {},
): {
  exec: CmuxCliExec;
  calls: CmuxCliExecRequest[];
} {
  const pending = [...queue];
  const calls: CmuxCliExecRequest[] = [];
  const onEmpty = options.onEmpty ?? "success";
  const recordCallSnapshots = options.recordCallSnapshots ?? true;

  return {
    calls,
    exec: async (req) => {
      const call = recordCallSnapshots
        ? {
            ...req,
            args: [...req.args],
            env: { ...req.env },
          }
        : req;
      calls.push(call);

      const next = pending.shift();
      if (next === undefined) {
        if (onEmpty === "throw") {
          throw new Error("cmux exec stub queue underflow");
        }
        return { exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false };
      }
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
