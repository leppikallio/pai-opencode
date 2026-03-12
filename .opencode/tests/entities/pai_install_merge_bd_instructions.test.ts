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

describe("runtime opencode.json Beads instructions merge", () => {
  test("creates strict runtime opencode.json and merges one canonical target-derived BD entry", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-install-bd-merge-"));
    const shimDir = createRtkShim({
      versionOutput: "rtk 0.22.9",
      tempPrefix: "pai-install-bd-rtk-shim-",
    });

    try {
      const run = runInstall({
        targetDir,
        pathValue: prependPath(shimDir),
      });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output).toBe(0);

      const expectedBdInstructionPath = path.join(targetDir, "BD.md");
      const legacyRuntimePath = path.join(os.homedir(), ".config", "opencode", "BD.md");

      expect(existsSync(expectedBdInstructionPath)).toBe(true);

      const { raw, parsed } = readRuntimeOpenCodeConfig(targetDir);
      expect(() => JSON.parse(raw)).not.toThrow();

      const instructions = expectInstructionEntries(parsed);
      expect(instructions.filter((entry) => entry === expectedBdInstructionPath)).toHaveLength(
        1,
      );
      expect(instructions).toContain(expectedBdInstructionPath);
      expect(instructions).not.toContain("~/.config/opencode/BD.md");
      expect(instructions).not.toContain(legacyRuntimePath);
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("normalizes duplicate BD instruction variants without clobbering unrelated runtime config", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-install-bd-dedupe-"));
    const shimDir = createRtkShim({
      versionOutput: "rtk 0.22.9",
      tempPrefix: "pai-install-bd-rtk-shim-",
    });

    try {
      const expectedBdInstructionPath = path.join(targetDir, "BD.md");
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
      const unrelatedProjectBdPath = path.join("/some", "other", "project", "BD.md");
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
              "~/.config/opencode/BD.md",
              { path: "~/.config/opencode/BD.md" },
              "BD.md",
              { path: "BD.md" },
              { path: expectedBdInstructionPath },
              expectedBdInstructionPath,
              unrelatedProjectBdPath,
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
      const ownedBdPathKeys = buildOwnedBdPathKeys(targetDir);

      expect(instructions.filter((entry) => entry === expectedBdInstructionPath)).toHaveLength(
        1,
      );
      expect(instructions).not.toContain("~/.config/opencode/BD.md");
      expect(instructions).not.toContain("BD.md");
      expect(instructions).toContain(unrelatedProjectBdPath);

      const nonBdInstructions = instructions.filter(
        (entry) => !isOwnedBdInstructionEntry(entry, ownedBdPathKeys),
      );
      expect(nonBdInstructions).toEqual([
        externalA,
        externalObjectInstruction,
        unsupportedInstructionShape,
        unrelatedProjectBdPath,
        externalB,
      ]);
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("repeated installs are idempotent for canonical runtime BD instructions", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-install-bd-idempotent-"));
    const shimDir = createRtkShim({
      versionOutput: "rtk 0.22.9",
      tempPrefix: "pai-install-bd-rtk-shim-",
    });

    try {
      const run1 = runInstall({
        targetDir,
        pathValue: prependPath(shimDir),
      });
      expect(run1.status, `${run1.stdout ?? ""}\n${run1.stderr ?? ""}`).toBe(0);

      const firstConfig = readRuntimeOpenCodeConfig(targetDir);
      const expectedBdInstructionPath = path.join(targetDir, "BD.md");
      const firstInstructions = expectInstructionEntries(firstConfig.parsed);

      expect(firstInstructions.filter((entry) => entry === expectedBdInstructionPath)).toHaveLength(
        1,
      );

      const run2 = runInstall({
        targetDir,
        pathValue: prependPath(shimDir),
      });
      expect(run2.status, `${run2.stdout ?? ""}\n${run2.stderr ?? ""}`).toBe(0);

      const secondConfig = readRuntimeOpenCodeConfig(targetDir);
      expect(secondConfig.raw).toBe(firstConfig.raw);

      const secondInstructions = expectInstructionEntries(secondConfig.parsed);
      expect(secondInstructions.filter((entry) => entry === expectedBdInstructionPath)).toHaveLength(
        1,
      );
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
