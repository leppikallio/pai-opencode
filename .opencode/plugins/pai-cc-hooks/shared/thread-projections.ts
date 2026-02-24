import fs from "node:fs";
import path from "node:path";

import { getCurrentWorkPathForSession } from "../../lib/paths";

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
    if (!Number.isFinite(args.maxChars) || args.maxChars <= 0) {
      return "";
    }
    return raw.slice(-args.maxChars);
  } catch {
    return "";
  }
}
