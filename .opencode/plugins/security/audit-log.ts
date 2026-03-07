import * as fs from "node:fs";
import * as path from "node:path";

import { fileLogError } from "../lib/file-logger";
import { ensureDir, getSecurityDir, getYearMonth } from "../lib/paths";

export type SecurityAuditEntry = Record<string, unknown>;
export type AppendSecurityAuditLog = (entry: SecurityAuditEntry) => Promise<void>;

export function createSecurityAuditLogger(options?: { disabled?: boolean }): AppendSecurityAuditLog {
  if (options?.disabled) {
    return async () => {
      // Intentionally disabled.
    };
  }

  return async (entry) => {
    const dir = path.join(getSecurityDir(), getYearMonth());
    const filePath = path.join(dir, "security.jsonl");

    try {
      await ensureDir(dir);

      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.size > 10 * 1024 * 1024) {
          const rotated = filePath.replace(/\.jsonl$/, `.${Date.now()}.jsonl`);
          await fs.promises.rename(filePath, rotated);
        }
      } catch {
        // Ignore missing file errors.
      }

      await fs.promises.appendFile(filePath, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      fileLogError("Failed to write security log", error);
    }
  };
}
