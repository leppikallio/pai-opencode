import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot =
  path.basename(process.cwd()) === ".opencode"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();

const installToolPath = path.join(repoRoot, "Tools", "Install.ts");
const sourceDir = path.join(repoRoot, ".opencode");

function prependPath(binDir: string): string {
  const existingPath = process.env.PATH ?? "";
  return existingPath.length > 0 ? `${binDir}:${existingPath}` : binDir;
}

function createRtkShim(args: { versionOutput: string }): string {
  const shimDir = mkdtempSync(path.join(os.tmpdir(), "pai-install-rtk-shim-"));
  const shimPath = path.join(shimDir, "rtk");
  const script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "${args.versionOutput}"
  exit 0
fi
if [ "$1" = "rewrite" ]; then
  shift
  printf "rtk %s\\n" "$*"
  exit 0
fi
exit 1
`;

  writeFileSync(shimPath, script, "utf8");
  chmodSync(shimPath, 0o755);
  return shimDir;
}

function runInstall(args: { targetDir: string; pathValue: string }) {
  return spawnSync(
    "bun",
    [
      installToolPath,
      "--target",
      args.targetDir,
      "--source",
      sourceDir,
      "--non-interactive",
      "--skills",
      "all",
      "--skills-gate-profile",
      "off",
      "--no-install-deps",
      "--no-verify",
    ],
    {
      encoding: "utf8",
      shell: false,
      env: {
        ...process.env,
        PATH: args.pathValue,
      },
    },
  );
}

function readRuntimeOpenCodeConfig(targetDir: string): {
  raw: string;
  parsed: Record<string, unknown>;
} {
  const configPath = path.join(targetDir, "opencode.json");
  const raw = readFileSync(configPath, "utf8");
  return {
    raw,
    parsed: JSON.parse(raw) as Record<string, unknown>,
  };
}

function expectInstructionArray(config: Record<string, unknown>): string[] {
  const instructions = config.instructions;
  expect(Array.isArray(instructions)).toBe(true);
  expect((instructions as unknown[]).every((entry) => typeof entry === "string")).toBe(
    true,
  );
  return instructions as string[];
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

function isOwnedRtkInstructionEntry(entry: string, ownedPathKeys: Set<string>): boolean {
  return ownedPathKeys.has(canonicalInstructionPath(entry));
}

describe("runtime opencode.json RTK instructions merge (Task 1 RED)", () => {
  test("creates strict runtime opencode.json and merges one canonical target-derived RTK entry", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-install-rtk-merge-"));
    const shimDir = createRtkShim({ versionOutput: "rtk 0.23.0" });

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

      const instructions = expectInstructionArray(parsed);
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
    const shimDir = createRtkShim({ versionOutput: "rtk 0.23.0" });

    try {
      const expectedRtkInstructionPath = path.join(targetDir, "RTK.md");
      const externalA = "https://example.com/instructions/a.md";
      const externalB = "https://example.com/instructions/b.md";
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
              "~/.config/opencode/RTK.md",
              { path: "~/.config/opencode/RTK.md" },
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

      const instructions = expectInstructionArray(parsed);
      const ownedRtkPathKeys = buildOwnedRtkPathKeys(targetDir);

      expect(instructions.filter((entry) => entry === expectedRtkInstructionPath)).toHaveLength(
        1,
      );
      expect(instructions).not.toContain("~/.config/opencode/RTK.md");
      expect(instructions).toContain(unrelatedProjectRtkPath);

      const nonRtkInstructions = instructions.filter(
        (entry) => !isOwnedRtkInstructionEntry(entry, ownedRtkPathKeys),
      );
      expect(nonRtkInstructions).toEqual([externalA, unrelatedProjectRtkPath, externalB]);
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("removes stale RTK instruction entries when capability cache refresh says rewrite unsupported", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-install-rtk-unsupported-"));
    const shimDir = createRtkShim({ versionOutput: "rtk 0.22.9" });

    try {
      const expectedRtkInstructionPath = path.join(targetDir, "RTK.md");
      const externalA = "https://example.com/instructions/a.md";
      const externalB = "https://example.com/instructions/b.md";
      const unrelatedProjectRtkPath = path.join("/some", "other", "project", "RTK.md");
      const runtimeConfigPath = path.join(targetDir, "opencode.json");

      writeFileSync(
        runtimeConfigPath,
        `${JSON.stringify(
          {
            instructions: [
              externalA,
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
      const instructions = expectInstructionArray(parsed);
      const ownedRtkPathKeys = buildOwnedRtkPathKeys(targetDir);

      expect(
        instructions.some((entry) => isOwnedRtkInstructionEntry(entry, ownedRtkPathKeys)),
      ).toBe(false);
      expect(instructions).toEqual([externalA, unrelatedProjectRtkPath, externalB]);
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
