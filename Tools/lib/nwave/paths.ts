import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function isDirectory(dirPath: string): boolean {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

export function looksLikeNwaveRoot(nwaveRoot: string): boolean {
  if (!isDirectory(nwaveRoot)) return false;

  const requiredDirectories = [
    "agents",
    path.join("tasks", "nw"),
    "skills",
    "data",
    "templates",
  ];

  return requiredDirectories.every((rel) => isDirectory(path.join(nwaveRoot, rel)));
}

export function guessNwaveRoot(args?: { cwd?: string; env?: NodeJS.ProcessEnv }): string | null {
  const cwd = path.resolve(args?.cwd ?? process.cwd());
  const env = args?.env ?? process.env;

  const envNwaveRoot = env.NWAVE_ROOT;
  if (envNwaveRoot && looksLikeNwaveRoot(envNwaveRoot)) {
    return path.resolve(envNwaveRoot);
  }

  const envNwaveRepoRoot = env.NWAVE_REPO_ROOT;
  if (envNwaveRepoRoot) {
    const candidate = path.join(envNwaveRepoRoot, "nWave");
    if (looksLikeNwaveRoot(candidate)) {
      return path.resolve(candidate);
    }
  }

  const candidates = [
    // Default layout for this mono-workspace: ~/Projects/nWave/nWave
    path.join(os.homedir(), "Projects", "nWave", "nWave"),
    // Common layout when pai-opencode and nWave live as sibling repos.
    path.resolve(cwd, "..", "nWave", "nWave"),
    // Common layout when command is run from the nWave repo root.
    path.resolve(cwd, "nWave"),
    // Slightly more lenient fallback for nested working dirs.
    path.resolve(cwd, "..", "..", "nWave", "nWave"),
  ];

  for (const candidate of candidates) {
    if (looksLikeNwaveRoot(candidate)) {
      return candidate;
    }
  }

  return null;
}
