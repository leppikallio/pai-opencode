import os from "node:os";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

function expandTildePath(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

// Keep this identity model aligned with prompt-control canonicalSourcePathKey().
export function canonicalSourcePathKey(rawPath: string, baseDir: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return "";
  }

  const expanded = expandTildePath(trimmed);
  const withNativeSeparators = expanded.replace(/[\\/]+/g, path.sep);
  const resolved = path.resolve(baseDir, withNativeSeparators);
  return resolved.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

export function instructionPathValue(entry: unknown): string | null {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return null;
  }

  const candidatePath = (entry as JsonRecord).path;
  if (typeof candidatePath !== "string") {
    return null;
  }

  const trimmed = candidatePath.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildOwnedInstructionPathKeys(args: {
  targetDir: string;
  instructionFileName: string;
}): Set<string> {
  const canonicalRuntimePath = path.resolve(path.join(args.targetDir, args.instructionFileName));
  const legacyRuntimePath = path.join(
    os.homedir(),
    ".config",
    "opencode",
    args.instructionFileName,
  );

  return new Set([
    canonicalSourcePathKey(canonicalRuntimePath, args.targetDir),
    canonicalSourcePathKey(legacyRuntimePath, args.targetDir),
  ]);
}

export function isOwnedInstructionEntry(args: {
  entry: unknown;
  ownedPathKeys: Set<string>;
  configDir: string;
}): boolean {
  const pathValue = instructionPathValue(args.entry);
  if (!pathValue) {
    return false;
  }

  const normalized = canonicalSourcePathKey(pathValue, args.configDir);
  return normalized.length > 0 && args.ownedPathKeys.has(normalized);
}
