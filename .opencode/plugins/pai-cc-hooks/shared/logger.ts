import { fileLog } from "../../lib/file-logger";

export function log(message: string, data?: unknown): void {
  if (data !== undefined) {
    try {
      fileLog(`${message} ${JSON.stringify(data)}`, "debug");
      return;
    } catch {
      // Fall through to best-effort plain message.
    }
  }

  fileLog(message, "debug");
}
