import type { ParsedTranscript } from "../../skills/PAI/Tools/TranscriptParser";

export async function handleVoice(parsed: ParsedTranscript, _sessionId?: string): Promise<void> {
  void parsed;
  // Voice is now routed exclusively via the `voice_notify` tool.
  // Hook-side network fetch is intentionally disabled.
}
