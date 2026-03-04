export type WorkJsonBackfillDecision = {
  shouldRun: boolean;
  reason: string;
};

export type WorkJsonBackfillGateInput =
  | { state: "missing" }
  | { state: "unreadable" }
  | { state: "not-file" }
  | {
      state: "file";
      sizeBytes: number;
      content: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sessionHasPrdPath(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const prdPath = value.prdPath;
  return typeof prdPath === "string" && prdPath.trim().length > 0;
}

export function decideWorkJsonBackfill(input: WorkJsonBackfillGateInput): WorkJsonBackfillDecision {
  if (input.state === "missing") {
    return { shouldRun: true, reason: "work.json missing" };
  }

  if (input.state === "unreadable") {
    return { shouldRun: true, reason: "work.json unreadable" };
  }

  if (input.state === "not-file") {
    return { shouldRun: true, reason: "work.json not a file" };
  }

  if (input.sizeBytes === 0) {
    return { shouldRun: true, reason: "work.json empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch {
    return { shouldRun: true, reason: "work.json parse failed" };
  }

  const parsedRecord = isRecord(parsed) ? parsed : null;
  const sessions = parsedRecord && isRecord(parsedRecord.sessions) ? parsedRecord.sessions : null;
  if (!sessions) {
    return { shouldRun: true, reason: "sessions missing" };
  }

  const entries = Object.values(sessions);
  if (entries.length === 0) {
    return { shouldRun: true, reason: "sessions empty" };
  }

  if (entries.some((entry) => !sessionHasPrdPath(entry))) {
    return { shouldRun: true, reason: "sessions missing prdPath" };
  }

  return { shouldRun: false, reason: "all sessions have prdPath" };
}
