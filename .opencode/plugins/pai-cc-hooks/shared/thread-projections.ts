import fs from "node:fs";
import path from "node:path";

import { getCurrentWorkPathForSession } from "../../lib/paths";

function takeLastCodePoints(text: string, maxCodePoints: number): string {
  if (!Number.isFinite(maxCodePoints) || maxCodePoints <= 0) {
    return "";
  }

  const safeMax = Math.floor(maxCodePoints);
  if (safeMax <= 0) {
    return "";
  }

  const codePoints = Array.from(text);
  return codePoints.slice(-safeMax).join("");
}

export async function getConversationTextFromThread(args: {
  sessionId: string;
  maxChars: number;
}): Promise<string> {
  const workPath = await getCurrentWorkPathForSession(args.sessionId);
  if (!workPath) {
    return "";
  }

  const threadPath = path.join(workPath, "THREAD.md");
  try {
    const raw = await fs.promises.readFile(threadPath, "utf-8");
    return takeLastCodePoints(raw, args.maxChars);
  } catch {
    return "";
  }
}
