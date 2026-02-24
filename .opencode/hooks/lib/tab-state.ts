import { notify } from "../../plugins/pai-cc-hooks/shared/cmux-adapter";

const TAB_TITLE_PREFIX_RE = /^(?:🧠|⚙️|⚙|✓|❓|👁️|📋|🔨|⚡|✅|📚)\s*/;

export type TabState = "idle" | "thinking" | "working" | "question" | "completed";

export type AlgorithmTabPhase =
  | "OBSERVE"
  | "THINK"
  | "PLAN"
  | "BUILD"
  | "EXECUTE"
  | "VERIFY"
  | "LEARN"
  | "COMPLETE"
  | "IDLE";

interface TabSnapshot {
  title: string;
  state: TabState;
  previousTitle?: string;
  phase?: AlgorithmTabPhase;
}

const snapshots = new Map<string, TabSnapshot>();

function normalizeSessionId(sessionId?: string): string | null {
  if (!sessionId) {
    return null;
  }
  const trimmed = sessionId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function shouldUseCmux(): boolean {
  return Boolean(process.env.CMUX_SOCKET_PATH?.trim());
}

export async function setTabState(args: {
  title: string;
  state: TabState;
  previousTitle?: string;
  sessionId?: string;
}): Promise<void> {
  const sessionId = normalizeSessionId(args.sessionId);
  if (!sessionId) {
    return;
  }

  const title = args.title.trim();
  snapshots.set(sessionId, {
    title,
    state: args.state,
    previousTitle: args.previousTitle,
  });

  if (!title || !shouldUseCmux()) {
    return;
  }

  try {
    await notify({
      sessionId,
      title: "PAI",
      subtitle: "Tab",
      body: title,
    });
  } catch {
    // Defensive no-op by contract.
  }
}

export function readTabState(sessionId?: string): TabSnapshot | null {
  const key = normalizeSessionId(sessionId);
  if (!key) {
    return null;
  }

  return snapshots.get(key) ?? null;
}

export function stripPrefix(title: string): string {
  return title.replace(TAB_TITLE_PREFIX_RE, "").trim();
}

export function getSessionOneWord(sessionId: string): string | null {
  const current = readTabState(sessionId);
  if (!current?.title) {
    return null;
  }

  const words = stripPrefix(current.title)
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2);

  return words.length > 0 ? words.join(" ").toUpperCase() : null;
}

export async function setPhaseTab(
  phase: AlgorithmTabPhase,
  sessionId: string,
  summary?: string,
): Promise<void> {
  const oneWord = getSessionOneWord(sessionId) ?? "WORKING";
  const fallbackSummary = summary?.trim() ? summary.trim() : oneWord;

  const phaseMap: Record<Exclude<AlgorithmTabPhase, "COMPLETE" | "IDLE">, { symbol: string; state: TabState }> = {
    OBSERVE: { symbol: "👁️", state: "working" },
    THINK: { symbol: "🧠", state: "thinking" },
    PLAN: { symbol: "📋", state: "working" },
    BUILD: { symbol: "🔨", state: "working" },
    EXECUTE: { symbol: "⚡", state: "working" },
    VERIFY: { symbol: "✅", state: "working" },
    LEARN: { symbol: "📚", state: "working" },
  };

  if (phase === "COMPLETE") {
    await setTabState({ title: `✅ ${fallbackSummary}`, state: "completed", sessionId });
    const current = readTabState(sessionId);
    if (current) {
      snapshots.set(sessionId, { ...current, phase });
    }
    return;
  }

  if (phase === "IDLE") {
    await setTabState({ title: oneWord, state: "idle", sessionId });
    const current = readTabState(sessionId);
    if (current) {
      snapshots.set(sessionId, { ...current, phase });
    }
    return;
  }

  const phaseConfig = phaseMap[phase];
  await setTabState({
    title: `${phaseConfig.symbol} ${oneWord}`,
    state: phaseConfig.state,
    sessionId,
  });

  const current = readTabState(sessionId);
  if (current) {
    snapshots.set(sessionId, { ...current, phase });
  }
}
