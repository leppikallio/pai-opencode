import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getPaiDir } from "../lib/paths";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function readSettings(settingsPath: string): JsonRecord | null {
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
    return asRecord(parsed) ?? {};
  } catch (error) {
    console.error("[UpdateCounts] Failed to parse settings.json:", error);
    return null;
  }
}

function writeSettingsAtomic(settingsPath: string, content: string): void {
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, content, "utf8");

  try {
    renameSync(tempPath, settingsPath);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {}

    throw error;
  }
}

function countHookScripts(paiDir: string): number {
  const hooksDir = join(paiDir, "hooks");

  try {
    const entries = readdirSync(hooksDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".hook.ts")).length;
  } catch {
    return 0;
  }
}

async function refreshUsageCache(_paiDir: string): Promise<void> {
  if (process.env.PAI_NO_NETWORK === "1") {
    return;
  }

  // External usage refresh is intentionally deferred in this port.
}

export async function handleUpdateCounts(): Promise<void> {
  const paiDir = getPaiDir();
  const settingsPath = join(paiDir, "settings.json");

  try {
    const hooksCount = countHookScripts(paiDir);
    await refreshUsageCache(paiDir);

    const settings = readSettings(settingsPath);
    if (settings === null) {
      return;
    }

    const currentCounts = asRecord(settings.counts) ?? {};

    settings.counts = {
      ...currentCounts,
      hooks: hooksCount,
      updatedAt: new Date().toISOString(),
    };

    writeSettingsAtomic(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  } catch (error) {
    console.error("[UpdateCounts] Failed to update counts:", error);
  }
}

if (import.meta.main) {
  handleUpdateCounts().finally(() => process.exit(0));
}
