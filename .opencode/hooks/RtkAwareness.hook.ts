#!/usr/bin/env bun

import { promises as fs } from "node:fs";
import path from "node:path";

import { getPaiDir } from "./lib/paths";

type RtkCapabilityRecord = {
  present: boolean;
  version: string | null;
  supportsRewrite: boolean;
};

function isRtkCapabilityRecord(value: unknown): value is RtkCapabilityRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const version = record.version;

  return (
    typeof record.present === "boolean"
    && (version === null || typeof version === "string")
    && typeof record.supportsRewrite === "boolean"
  );
}

function getCapabilityCachePath(): string {
  return path.join(getPaiDir(), "MEMORY", "STATE", "rtk", "capability.json");
}

async function readCachedCapability(): Promise<RtkCapabilityRecord | null> {
  try {
    const raw = await fs.readFile(getCapabilityCachePath(), "utf8");
    const parsed = JSON.parse(raw);
    return isRtkCapabilityRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildAwarenessReminder(): string {
  return `<system-reminder>\nRTK rewrite support is active for this runtime.\nDetailed RTK semantics live in RTK.md.\nIf RTK emits a tee/raw-output hint, follow RTK.md recovery guidance (OpenCode Read or rtk proxy).\n\nUse RTK meta commands directly when needed:\n- rtk gain\n- rtk gain --history\n- rtk discover\n- rtk proxy <cmd>\n\nThis hook is capability/status reminder only.\n</system-reminder>\n`;
}

async function main(): Promise<void> {
  if (process.execArgv.includes("--check")) {
    process.exit(0);
  }

  const capability = await readCachedCapability();
  if (!capability?.supportsRewrite) {
    process.exit(0);
  }

  process.stdout.write(buildAwarenessReminder());
  process.exit(0);
}

await main();
