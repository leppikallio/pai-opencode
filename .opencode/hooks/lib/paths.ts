import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function expandPath(pathValue: string): string {
  return pathValue
    .replace(/^\$HOME(?=\/|$)/, homedir())
    .replace(/^\$\{HOME\}(?=\/|$)/, homedir())
    .replace(/^~(?=\/|$)/, homedir());
}

function isRuntimeRoot(candidate: string): boolean {
  return existsSync(join(candidate, "hooks")) && existsSync(join(candidate, "skills"));
}

function defaultPaiDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome && !xdgConfigHome.includes("${")) {
    return resolve(expandPath(xdgConfigHome), "opencode");
  }

  return join(homedir(), ".config", "opencode");
}

function inferPaiDirFromRuntime(): string | null {
  const fromInstalledRuntime = resolve(import.meta.dir, "..", "..");
  if (isRuntimeRoot(fromInstalledRuntime)) {
    return fromInstalledRuntime;
  }

  const fromRepoRoot = resolve(import.meta.dir, "..", "..", "..");
  const fromSourceRuntime = resolve(fromRepoRoot, ".opencode");
  if (isRuntimeRoot(fromSourceRuntime)) {
    return fromSourceRuntime;
  }

  return null;
}

function getRuntimeRootFromEnv(): string | null {
  const envKeys = ["OPENCODE_ROOT", "OPENCODE_CONFIG_ROOT"] as const;

  for (const key of envKeys) {
    const value = process.env[key]?.trim();
    if (!value || value.includes("${")) {
      continue;
    }

    return resolve(expandPath(value));
  }

  return null;
}

export function getPaiDir(): string {
  const fromEnv = getRuntimeRootFromEnv();
  if (fromEnv) {
    return fromEnv;
  }

  const fromRuntime = inferPaiDirFromRuntime();
  if (fromRuntime) {
    return fromRuntime;
  }

  return defaultPaiDir();
}

export function paiPath(...parts: string[]): string {
  return join(getPaiDir(), ...parts);
}
