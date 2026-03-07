import * as path from "node:path";

import type { PathRules } from "./project-rules";

export type PathAction = "read" | "write" | "delete";

export type PathValidationResult = {
  action: "allow" | "block" | "confirm";
  reason?: string;
};

function stripQuotes(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }

  return v;
}

function normalizeApplyPatchPath(value: string): string {
  const stripped = stripQuotes(value);
  if (!stripped) {
    return "";
  }

  return stripped.replace(/\\/g, "/");
}

function expandHome(candidatePath: string): string {
  if (!candidatePath.startsWith("~")) {
    return candidatePath;
  }

  const home = process.env.HOME || "/Users/zuul";
  if (candidatePath === "~") {
    return home;
  }

  if (candidatePath.startsWith("~/")) {
    return path.join(home, candidatePath.slice(2));
  }

  return candidatePath;
}

export function matchesPathPattern(filePath: string, pattern: string): boolean {
  const expandedPattern = expandHome(pattern);
  const expandedPath = path.resolve(expandHome(filePath));

  function normalize(inputPattern: string): string[] {
    if (inputPattern.startsWith("/") || inputPattern.startsWith("~")) {
      return [inputPattern];
    }

    return [inputPattern, `**/${inputPattern}`];
  }

  const patterns = normalize(expandedPattern);

  for (const candidatePattern of patterns) {
    if (candidatePattern.includes("*")) {
      const regexPattern = candidatePattern
        .replace(/\*\*/g, "<<<DOUBLESTAR>>>")
        .replace(/\*/g, "<<<SINGLESTAR>>>")
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/<<<DOUBLESTAR>>>/g, ".*")
        .replace(/<<<SINGLESTAR>>>/g, "[^/]*");

      try {
        const re = new RegExp(`^${regexPattern}$`);
        if (re.test(expandedPath)) {
          return true;
        }
      } catch {
        // Ignore invalid generated regex and continue.
      }

      continue;
    }

    const expandedCandidate = expandHome(candidatePattern);
    const prefix = expandedCandidate.endsWith("/") ? expandedCandidate : `${expandedCandidate}/`;

    if (expandedPath === expandedCandidate || expandedPath.startsWith(prefix)) {
      return true;
    }

    if (!expandedCandidate.includes("/") && path.basename(expandedPath) === expandedCandidate) {
      return true;
    }
  }

  return false;
}

export function validatePathAccess(
  filePath: string,
  action: PathAction,
  pathRules: PathRules,
): PathValidationResult {
  for (const candidatePattern of pathRules.zeroAccess) {
    if (matchesPathPattern(filePath, candidatePattern)) {
      return { action: "block", reason: `Zero access path: ${candidatePattern}` };
    }
  }

  if (action === "write" || action === "delete") {
    for (const candidatePattern of pathRules.readOnly) {
      if (matchesPathPattern(filePath, candidatePattern)) {
        return { action: "block", reason: `Read-only path: ${candidatePattern}` };
      }
    }
  }

  if (action === "write") {
    for (const candidatePattern of pathRules.confirmWrite) {
      if (matchesPathPattern(filePath, candidatePattern)) {
        return {
          action: "confirm",
          reason: `Writing protected path requires confirmation: ${candidatePattern}`,
        };
      }
    }
  }

  if (action === "delete") {
    for (const candidatePattern of pathRules.noDelete) {
      if (matchesPathPattern(filePath, candidatePattern)) {
        return { action: "block", reason: `Cannot delete protected path: ${candidatePattern}` };
      }
    }
  }

  return { action: "allow" };
}

export function extractApplyPatchPaths(patchText: string): Array<{ action: PathAction; filePath: string }> {
  const out: Array<{ action: PathAction; filePath: string }> = [];
  const lines = patchText.split(/\r?\n/);

  let pendingUpdatePath: string | null = null;
  let pendingUpdateMoved = false;

  const flushPendingUpdate = () => {
    if (pendingUpdatePath && !pendingUpdateMoved) {
      out.push({ action: "write", filePath: pendingUpdatePath });
    }

    pendingUpdatePath = null;
    pendingUpdateMoved = false;
  };

  for (const line of lines) {
    const operationMatch = line.match(/^\*\*\*\s+(Add File|Update File|Delete File):\s+(.+)\s*$/);
    if (operationMatch) {
      flushPendingUpdate();

      const operation = operationMatch[1];
      const filePath = normalizeApplyPatchPath(operationMatch[2] ?? "");
      if (!filePath) {
        continue;
      }

      if (operation === "Update File") {
        pendingUpdatePath = filePath;
        continue;
      }

      if (operation === "Delete File") {
        out.push({ action: "delete", filePath });
      } else {
        out.push({ action: "write", filePath });
      }

      continue;
    }

    const moveToMatch = line.match(/^\*\*\*\s+Move to:\s+(.+)\s*$/);
    if (moveToMatch && pendingUpdatePath) {
      const destination = normalizeApplyPatchPath(moveToMatch[1] ?? "");
      out.push({ action: "delete", filePath: pendingUpdatePath });
      if (destination) {
        out.push({ action: "write", filePath: destination });
      }
      pendingUpdateMoved = true;
    }
  }

  flushPendingUpdate();
  return out;
}

export function resolveApplyPatchPaths(args: {
  paiDir: string;
  cwd: string;
  filePathRaw: string;
}): string[] {
  const raw = normalizeApplyPatchPath(args.filePathRaw);
  if (!raw) {
    return [];
  }

  const expanded = expandHome(raw);
  if (/^[A-Za-z]:[\\/]/.test(expanded)) {
    return [path.win32.resolve(expanded).replace(/\\/g, "/")];
  }

  if (expanded.startsWith("/")) {
    return [path.resolve(expanded)];
  }

  const normalized = expanded.replace(/\\/g, "/");
  const candidates = [
    path.resolve(path.join(args.cwd, normalized)),
    path.resolve(path.join(args.paiDir, normalized)),
  ];

  return Array.from(new Set(candidates));
}
