export type TickResultLike =
  | { ok: true; decision_inputs_digest?: unknown }
  | { ok: false; error: { code?: unknown; message?: unknown } };

export type TickOutcome = {
  outcome: "succeeded" | "failed" | "timed_out" | "cancelled";
  failureKind?: "timeout" | "tool_error" | "invalid_output" | "gate_failed" | "unknown";
  retryable?: boolean;
  message?: string;
};

export function computeTickOutcome(args: {
  tickResult: TickResultLike;
  stageBefore: string;
  stageAfter: string;
  statusAfter: string;
  toolError: { code: string; message: string } | null;
}): TickOutcome {
  if (args.statusAfter === "cancelled") {
    return {
      outcome: "cancelled",
      failureKind: "unknown",
      retryable: false,
      message: "run cancelled",
    };
  }

  if (args.tickResult.ok) {
    if (args.stageAfter !== args.stageBefore) {
      return { outcome: "succeeded" };
    }
    return {
      outcome: "failed",
      failureKind: "invalid_output",
      retryable: args.statusAfter === "running",
      message: "stage did not advance",
    };
  }

  const errorCodeUpper = String(args.toolError?.code ?? args.tickResult.error.code ?? "").toUpperCase();
  if (errorCodeUpper.includes("TIMEOUT")) {
    return {
      outcome: "timed_out",
      failureKind: "timeout",
      retryable: false,
      message: args.toolError?.message ?? String(args.tickResult.error.message ?? "tick failed"),
    };
  }

  return {
    outcome: "failed",
    failureKind: "tool_error",
    retryable: false,
    message: args.toolError?.message ?? String(args.tickResult.error.message ?? "tick failed"),
  };
}
