#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.execArgv.includes("--check")) {
  process.exit(0);
}

function resolvePaiDir(): string {
  const envKeys = ["OPENCODE_ROOT", "OPENCODE_CONFIG_ROOT"] as const;
  for (const key of envKeys) {
    const envRuntimeRoot = process.env[key]?.trim();
    if (envRuntimeRoot && !envRuntimeRoot.includes("${")) {
      return envRuntimeRoot;
    }
  }

  const scriptFile = fileURLToPath(import.meta.url);
  const hooksDir = dirname(scriptFile);
  return dirname(hooksDir);
}

const paiDir = resolvePaiDir();
const bannerToolPath = join(paiDir, "skills", "PAI", "Tools", "Banner.ts");

try {
  const child = spawn("bun", [bannerToolPath], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      OPENCODE_ROOT: paiDir,
      OPENCODE_CONFIG_ROOT: paiDir,
    },
  });

  child.unref();
} catch (error) {
  const reason = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`[StartupGreeting] Failed to display banner: ${reason}\n`);
}

process.exit(0);
