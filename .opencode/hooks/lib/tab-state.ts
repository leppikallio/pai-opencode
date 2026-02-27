import { mirrorCurrentCmuxPhase, renameCurrentCmuxSurfaceTitle } from "./cmux-v2";
import {
  normalizeTabSessionId,
  readTabSnapshot,
  type AlgorithmTabPhase,
  type TabSnapshot,
  type TabState,
  writeTabSnapshotAtomic,
} from "./tab-state-store";

const TAB_TITLE_PREFIX_RE = /^(?:🧠|⚙️|⚙|✓|❓|👁️|📋|🔨|⚡|✅|📚)\s*/;

export type { AlgorithmTabPhase, TabState };
export type TabPhaseMirrorToken =
  | "OBSERVE"
  | "THINK"
  | "PLAN"
  | "BUILD"
  | "WORK"
  | "EXECUTE"
  | "QUESTION"
  | "LEARN"
  | "DONE";

export async function setTabState(args: {
  title: string;
  state: TabState;
  previousTitle?: string;
  sessionId?: string;
  phaseToken?: TabPhaseMirrorToken;
}): Promise<void> {
  const sessionId = normalizeTabSessionId(args.sessionId);
  if (!sessionId) {
    return;
  }

  const title = args.title.trim();
  await writeTabSnapshotAtomic(sessionId, {
    title,
    state: args.state,
    previousTitle: args.previousTitle,
  });

  if (!title) {
    return;
  }

  await renameCurrentCmuxSurfaceTitle(title, { sessionId });

  if (args.phaseToken) {
    await mirrorCurrentCmuxPhase({ phaseToken: args.phaseToken, sessionId });
  }
}

export function readTabState(sessionId?: string): TabSnapshot | null {
  const key = normalizeTabSessionId(sessionId);
  if (!key) {
    return null;
  }

  return readTabSnapshot(key);
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
      await writeTabSnapshotAtomic(sessionId, { ...current, phase });
    }
    return;
  }

  if (phase === "IDLE") {
    await setTabState({ title: oneWord, state: "idle", sessionId });
    const current = readTabState(sessionId);
    if (current) {
      await writeTabSnapshotAtomic(sessionId, { ...current, phase });
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
    await writeTabSnapshotAtomic(sessionId, { ...current, phase });
  }
}
