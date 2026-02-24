import type { ParsedTranscript } from "../../skills/PAI/Tools/TranscriptParser";

import { setTabState } from "../lib/tab-state";

function toSummary(parsed: ParsedTranscript): string {
  const plain = parsed.plainCompletion.trim();
  if (plain) {
    return plain;
  }

  const summary = parsed.structured.summary?.trim();
  if (summary) {
    return summary;
  }

  return "Task complete";
}

export async function handleTabState(parsed: ParsedTranscript, sessionId?: string): Promise<void> {
  if (!sessionId || parsed.responseState === "awaitingInput") {
    return;
  }

  try {
    await setTabState({
      title: `✅ ${toSummary(parsed)}`,
      state: "completed",
      sessionId,
    });
  } catch {
    // Tab updates are best-effort by design.
  }
}
