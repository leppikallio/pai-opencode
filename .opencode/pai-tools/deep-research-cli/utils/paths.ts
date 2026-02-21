import * as fs from "node:fs/promises";
import * as path from "node:path";

export function requireAbsolutePath(value: string, flagName: string): string {
  const trimmed = value.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) {
    throw new Error(`${flagName} must be an absolute path`);
  }
  return trimmed;
}

export function isManifestRelativePathSafe(value: string): boolean {
  if (!value || value.startsWith(path.sep) || value.includes("/../") || value.includes("\\..\\")) {
    return false;
  }
  const normalized = path.normalize(value);
  return normalized !== ".."
    && !normalized.startsWith(`..${path.sep}`)
    && !normalized.split(path.sep).some((segment: string) => segment === "..");
}

export async function safeResolveManifestPath(runRoot: string, rel: string, field: string): Promise<string> {
  const relTrimmed = String(rel ?? "").trim() || "gates.json";
  if (!isManifestRelativePathSafe(relTrimmed)) {
    throw new Error(`${field} must be a relative path without traversal`);
  }

  // Normalize run root to a real path first so containment checks work on macOS
  // where `/var` is a symlink to `/private/var`.
  let runRootReal = runRoot;
  try {
    runRootReal = await fs.realpath(runRoot);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "ENOENT") throw error;
  }

  const candidate = path.resolve(runRootReal, relTrimmed);

  let parentPath = path.dirname(candidate);
  try {
    const parentReal = await fs.realpath(parentPath);
    parentPath = parentReal;
    const relFromRoot = path.relative(runRootReal, parentReal);
    if (relFromRoot === "" || relFromRoot === ".") {
      // keep candidate below runRoot when parent is root or direct child
    } else if (relFromRoot.startsWith(`..${path.sep}`) || relFromRoot === "..") {
      throw new Error(`${field} escapes runRoot`);
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  let candidateForCheck = path.resolve(parentPath, path.basename(candidate));
  try {
    candidateForCheck = await fs.realpath(candidateForCheck);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "ENOENT") throw error;
  }

  const relFromRoot = path.relative(runRootReal, candidateForCheck);
  if (relFromRoot === "" || relFromRoot === ".") {
    return path.join(runRootReal, path.basename(candidateForCheck));
  }
  if (relFromRoot.startsWith(`..${path.sep}`) || relFromRoot === "..") {
    throw new Error(`${field} escapes runRoot`);
  }

  return candidateForCheck;
}

export function isSafeSegment(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

export function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function validateRunId(runId: string): void {
  if (!runId) throw new Error("--run-id must be non-empty");
  if (path.isAbsolute(runId)) throw new Error("--run-id must not be an absolute path");
  if (runId === "." || runId === "..") throw new Error("--run-id must not be '.' or '..'");
  if (runId.includes("/") || runId.includes("\\")) throw new Error("--run-id must not contain path separators");
  if (runId.includes("..")) throw new Error("--run-id must not contain '..'");
}

export function assertWithinRoot(rootAbs: string, candidateAbs: string, field: string): void {
  const rel = path.relative(rootAbs, candidateAbs);
  if (rel === "" || rel === ".") return;
  if (rel.startsWith(`..${path.sep}`) || rel === ".." || path.isAbsolute(rel)) {
    throw new Error(`${field} resolves outside runs root`);
  }
}
