import type { ParsedTranscript } from "../../skills/PAI/Tools/TranscriptParser";

import { getIdentity } from "../lib/identity";

interface VoicePayload {
  message: string;
  title: string;
  voice_id?: string;
}

function getVoiceNotifyUrl(): string | null {
  const notifyUrl = process.env.PAI_VOICE_NOTIFY_URL?.trim();
  if (notifyUrl) {
    return notifyUrl;
  }

  const serverUrl = process.env.PAI_VOICE_SERVER_URL?.trim();
  if (!serverUrl) {
    return null;
  }

  return serverUrl.endsWith("/notify") ? serverUrl : `${serverUrl.replace(/\/$/, "")}/notify`;
}

function getVoiceMessage(parsed: ParsedTranscript): string {
  return parsed.voiceCompletion.trim();
}

export async function handleVoice(parsed: ParsedTranscript, _sessionId?: string): Promise<void> {
  if (process.env.PAI_DISABLE_VOICE === "1") {
    return;
  }

  if (process.env.PAI_NO_NETWORK === "1") {
    console.error("[VoiceNotification] Skipping network request: PAI_NO_NETWORK=1");
    return;
  }

  const url = getVoiceNotifyUrl();
  if (!url) {
    return;
  }

  const message = getVoiceMessage(parsed);
  if (!message) {
    return;
  }

  const identity = getIdentity();
  const payload: VoicePayload = {
    message,
    title: `${identity.name} says`,
  };
  if (identity.voiceId) {
    payload.voice_id = identity.voiceId;
  }

  const abortController = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = setTimeout(() => abortController?.abort(), 1_000);

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: abortController?.signal,
    });
  } catch {
    // Voice is best-effort by design.
  } finally {
    clearTimeout(timeout);
  }
}
