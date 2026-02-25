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

function inferPaiDirFromRuntime(): string | null {
  const fromHooksLib = resolve(import.meta.dir, "..", "..");
  if (isRuntimeRoot(fromHooksLib)) {
    return fromHooksLib;
  }

  const fromRepo = resolve(fromHooksLib, "..", ".opencode");
  if (isRuntimeRoot(fromRepo)) {
    return fromRepo;
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

  const fromCwd = resolve(process.cwd(), ".opencode");
  if (isRuntimeRoot(fromCwd)) {
    return fromCwd;
  }

  return process.cwd();
}

export function paiPath(...parts: string[]): string {
  return join(getPaiDir(), ...parts);
}
