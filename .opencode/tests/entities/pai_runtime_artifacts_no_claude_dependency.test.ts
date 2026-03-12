import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createRtkShim,
  prependPath,
  readRuntimeOpenCodeConfig,
  runInstall,
} from "./pai_install_runtime_test_helpers";

function instructionPathValue(entry: unknown): string | null {
  if (typeof entry === "string") {
    return entry;
  }

  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return null;
  }

  const candidatePath = (entry as { path?: unknown }).path;
  return typeof candidatePath === "string" ? candidatePath : null;
}

function canonicalInstructionPath(pathValue: string): string {
  const expanded =
    pathValue === "~"
      ? os.homedir()
      : pathValue.startsWith("~/") || pathValue.startsWith("~\\")
        ? path.join(os.homedir(), pathValue.slice(2))
        : pathValue;
  const withNativeSeparators = expanded.replace(/[\\/]+/g, path.sep);
  const resolved = path.resolve(withNativeSeparators);
  return resolved.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function buildOwnedBdPathKeys(targetDir: string): Set<string> {
  return new Set([
    canonicalInstructionPath(path.join(targetDir, "BD.md")),
    canonicalInstructionPath(path.join(os.homedir(), ".config", "opencode", "BD.md")),
  ]);
}

function isOwnedBdInstructionEntry(entry: unknown, ownedPathKeys: Set<string>): boolean {
  const candidatePath = instructionPathValue(entry);
  if (!candidatePath) {
    return false;
  }

  return ownedPathKeys.has(canonicalInstructionPath(candidatePath));
}

function listFilesRecursive(rootDir: string): string[] {
  const out: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const absPath = path.join(dir, entry);
      const stat = statSync(absPath);
      if (stat.isDirectory()) {
        walk(absPath);
      } else if (stat.isFile()) {
        out.push(absPath);
      }
    }
  };

  walk(rootDir);
  return out;
}

describe("runtime artifacts scoped no-.claude gate", () => {
  test("beads-owned runtime artifacts and BD instruction entries avoid .claude paths", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-runtime-no-claude-"));
    const shimDir = createRtkShim({
      versionOutput: "rtk 0.22.9",
      tempPrefix: "pai-runtime-no-claude-rtk-shim-",
    });

    try {
      const run = runInstall({
        targetDir,
        pathValue: prependPath(shimDir),
      });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output).toBe(0);

      const runtimeBdPath = path.join(targetDir, "BD.md");
      const runtimeBeadsRoot = path.join(targetDir, "skills", "utilities", "beads");
      expect(existsSync(runtimeBdPath)).toBe(true);
      expect(existsSync(runtimeBeadsRoot)).toBe(true);

      const { parsed } = readRuntimeOpenCodeConfig(targetDir);
      expect(Array.isArray(parsed.instructions)).toBe(true);
      const instructions = parsed.instructions as unknown[];

      const ownedBdPathKeys = buildOwnedBdPathKeys(targetDir);
      const ownedBdInstructionEntries = instructions.filter((entry) =>
        isOwnedBdInstructionEntry(entry, ownedBdPathKeys),
      );

      expect(ownedBdInstructionEntries).toHaveLength(1);
      expect(ownedBdInstructionEntries[0]).toBe(runtimeBdPath);

      for (const entry of ownedBdInstructionEntries) {
        const pathValue = instructionPathValue(entry);
        expect(pathValue).not.toContain(".claude");
      }

      const scopedArtifactFiles = [runtimeBdPath, ...listFilesRecursive(runtimeBeadsRoot)];
      for (const filePath of scopedArtifactFiles) {
        const content = readFileSync(filePath, "utf8");
        expect(content).not.toContain(".claude");
      }
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
