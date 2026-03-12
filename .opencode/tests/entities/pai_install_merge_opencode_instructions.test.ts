import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createRtkShim,
  prependPath,
  readRuntimeOpenCodeConfig,
  runInstall,
} from "./pai_install_runtime_test_helpers";

function expectInstructionEntries(config: Record<string, unknown>): unknown[] {
  const instructions = config.instructions;
  expect(Array.isArray(instructions)).toBe(true);
  return instructions as unknown[];
}

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

function buildOwnedRtkPathKeys(targetDir: string): Set<string> {
  return new Set([
    canonicalInstructionPath(path.join(targetDir, "RTK.md")),
    canonicalInstructionPath(path.join(os.homedir(), ".config", "opencode", "RTK.md")),
  ]);
}

function buildOwnedBdPathKeys(targetDir: string): Set<string> {
  return new Set([
    canonicalInstructionPath(path.join(targetDir, "BD.md")),
    canonicalInstructionPath(path.join(os.homedir(), ".config", "opencode", "BD.md")),
  ]);
}

function isOwnedRtkInstructionEntry(entry: unknown, ownedPathKeys: Set<string>): boolean {
  const candidatePath = instructionPathValue(entry);
  if (!candidatePath) {
    return false;
  }

  return ownedPathKeys.has(canonicalInstructionPath(candidatePath));
}

function isOwnedManagedInstructionEntry(args: {
  entry: unknown;
  ownedRtkPathKeys: Set<string>;
  ownedBdPathKeys: Set<string>;
}): boolean {
  const candidatePath = instructionPathValue(args.entry);
  if (!candidatePath) {
    return false;
  }

  const normalized = canonicalInstructionPath(candidatePath);
  return args.ownedRtkPathKeys.has(normalized) || args.ownedBdPathKeys.has(normalized);
}

describe("runtime opencode.json RTK instructions merge (Task 1 RED)", () => {
  test("creates strict runtime opencode.json and merges one canonical target-derived RTK entry", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-install-rtk-merge-"));
    const shimDir = createRtkShim({
      versionOutput: "rtk 0.23.0",
      tempPrefix: "pai-install-rtk-shim-",
    });

    try {
      const run = runInstall({
        targetDir,
        pathValue: prependPath(shimDir),
      });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output).toBe(0);

      const expectedRtkInstructionPath = path.join(targetDir, "RTK.md");
      const legacyRuntimePath = path.join(os.homedir(), ".config", "opencode", "RTK.md");

      expect(existsSync(expectedRtkInstructionPath)).toBe(true);

      const { raw, parsed } = readRuntimeOpenCodeConfig(targetDir);
      expect(() => JSON.parse(raw)).not.toThrow();

      const instructions = expectInstructionEntries(parsed);
      expect(instructions.filter((entry) => entry === expectedRtkInstructionPath)).toHaveLength(
        1,
      );
      expect(instructions).toContain(expectedRtkInstructionPath);
      expect(instructions).not.toContain("~/.config/opencode/RTK.md");
      expect(instructions).not.toContain(legacyRuntimePath);
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("normalizes duplicate RTK instruction variants without clobbering unrelated runtime config", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-install-rtk-dedupe-"));
    const shimDir = createRtkShim({
      versionOutput: "rtk 0.23.0",
      tempPrefix: "pai-install-rtk-shim-",
    });

    try {
      const expectedRtkInstructionPath = path.join(targetDir, "RTK.md");
      const externalA = "https://example.com/instructions/a.md";
      const externalB = "https://example.com/instructions/b.md";
      const externalObjectInstruction = {
        path: "https://example.com/instructions/object.md",
        source: "keep-object-shape",
      };
      const unsupportedInstructionShape = {
        include: ["docs/**/*.md"],
        tag: "keep-non-path-shape",
      };
      const unrelatedProjectRtkPath = path.join("/some", "other", "project", "RTK.md");
      const runtimeConfigPath = path.join(targetDir, "opencode.json");

      writeFileSync(
        runtimeConfigPath,
        `${JSON.stringify(
          {
            model: "openai/gpt-5",
            username: "petteri",
            instructions: [
              externalA,
              externalObjectInstruction,
              unsupportedInstructionShape,
              "~/.config/opencode/RTK.md",
              { path: "~/.config/opencode/RTK.md" },
              "RTK.md",
              { path: "RTK.md" },
              { path: expectedRtkInstructionPath },
              expectedRtkInstructionPath,
              unrelatedProjectRtkPath,
              externalB,
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const run = runInstall({
        targetDir,
        pathValue: prependPath(shimDir),
      });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output).toBe(0);

      const { parsed } = readRuntimeOpenCodeConfig(targetDir);
      expect(parsed.model).toBe("openai/gpt-5");
      expect(parsed.username).toBe("petteri");

      const instructions = expectInstructionEntries(parsed);
      const ownedRtkPathKeys = buildOwnedRtkPathKeys(targetDir);
      const ownedBdPathKeys = buildOwnedBdPathKeys(targetDir);

      expect(instructions.filter((entry) => entry === expectedRtkInstructionPath)).toHaveLength(
        1,
      );
      expect(instructions).not.toContain("~/.config/opencode/RTK.md");
      expect(instructions).not.toContain("RTK.md");
      expect(instructions).toContain(unrelatedProjectRtkPath);

      const nonRtkInstructions = instructions.filter(
        (entry) =>
          !isOwnedManagedInstructionEntry({
            entry,
            ownedRtkPathKeys,
            ownedBdPathKeys,
          }),
      );
      expect(nonRtkInstructions).toEqual([
        externalA,
        externalObjectInstruction,
        unsupportedInstructionShape,
        unrelatedProjectRtkPath,
        externalB,
      ]);
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("removes stale RTK instruction entries when capability cache refresh says rewrite unsupported", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-install-rtk-unsupported-"));
    const shimDir = createRtkShim({
      versionOutput: "rtk 0.22.9",
      tempPrefix: "pai-install-rtk-shim-",
    });

    try {
      const expectedRtkInstructionPath = path.join(targetDir, "RTK.md");
      const externalA = "https://example.com/instructions/a.md";
      const externalB = "https://example.com/instructions/b.md";
      const externalObjectInstruction = {
        path: "https://example.com/instructions/object.md",
        source: "keep-object-shape",
      };
      const unsupportedInstructionShape = {
        include: ["docs/**/*.md"],
        tag: "keep-non-path-shape",
      };
      const unrelatedProjectRtkPath = path.join("/some", "other", "project", "RTK.md");
      const runtimeConfigPath = path.join(targetDir, "opencode.json");

      writeFileSync(
        runtimeConfigPath,
        `${JSON.stringify(
          {
            instructions: [
              externalA,
              externalObjectInstruction,
              unsupportedInstructionShape,
              expectedRtkInstructionPath,
              "~/.config/opencode/RTK.md",
              { path: expectedRtkInstructionPath },
              unrelatedProjectRtkPath,
              externalB,
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const run = runInstall({
        targetDir,
        pathValue: prependPath(shimDir),
      });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output).toBe(0);

      const { parsed } = readRuntimeOpenCodeConfig(targetDir);
      const instructions = expectInstructionEntries(parsed);
      const ownedRtkPathKeys = buildOwnedRtkPathKeys(targetDir);
      const ownedBdPathKeys = buildOwnedBdPathKeys(targetDir);

      expect(
        instructions.some((entry) => isOwnedRtkInstructionEntry(entry, ownedRtkPathKeys)),
      ).toBe(false);
      const nonManagedInstructions = instructions.filter(
        (entry) =>
          !isOwnedManagedInstructionEntry({
            entry,
            ownedRtkPathKeys,
            ownedBdPathKeys,
          }),
      );
      expect(nonManagedInstructions).toEqual([
        externalA,
        externalObjectInstruction,
        unsupportedInstructionShape,
        unrelatedProjectRtkPath,
        externalB,
      ]);
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
