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

export function getPaiDir(): string {
  const fromEnv = process.env.PAI_DIR?.trim();
  if (fromEnv && !fromEnv.includes("${PAI_DIR}")) {
    return resolve(expandPath(fromEnv));
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
