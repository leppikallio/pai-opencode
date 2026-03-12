import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadConfiguredInstructions } from "../../plugins/handlers/prompt-sources";
import { createRtkShim, prependPath, runInstall } from "./pai_install_runtime_test_helpers";

describe("prompt-sources Beads runtime doc loading", () => {
  test("installs BD.md semantic source-of-truth contract", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-prompt-sources-bd-baseline-"));
    const shimDir = createRtkShim({
      versionOutput: "rtk 0.22.9",
      tempPrefix: "pai-prompt-sources-bd-rtk-shim-",
    });

    try {
      const run = runInstall({
        targetDir,
        pathValue: prependPath(shimDir),
      });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output).toBe(0);

      const runtimeBdPath = path.join(targetDir, "BD.md");
      const runtimeBdDoc = readFileSync(runtimeBdPath, "utf8");

      expect(runtimeBdDoc).toContain("BD.md is the OpenCode runtime Beads instruction source.");
      expect(runtimeBdDoc).toContain("Treat this file as the canonical runtime-installed Beads instructions document.");
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("loadConfiguredInstructions loads runtime BD.md from canonical absolute string instructions", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-prompt-sources-bd-runtime-"));
    const shimDir = createRtkShim({
      versionOutput: "rtk 0.22.9",
      tempPrefix: "pai-prompt-sources-bd-rtk-shim-",
    });

    try {
      const run = runInstall({
        targetDir,
        pathValue: prependPath(shimDir),
      });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output).toBe(0);

      const runtimeConfigPath = path.join(targetDir, "opencode.json");
      const expectedBdInstructionPath = path.join(targetDir, "BD.md");
      const sentinel = "BD_PROMPT_SOURCES_RUNTIME_SENTINEL_TASK2";

      writeFileSync(expectedBdInstructionPath, `${sentinel}\n`, "utf8");

      const runtimeConfig = JSON.parse(readFileSync(runtimeConfigPath, "utf8")) as {
        instructions?: unknown;
      };

      expect(Array.isArray(runtimeConfig.instructions)).toBe(true);
      expect(
        (runtimeConfig.instructions as unknown[]).every((entry) => typeof entry === "string"),
      ).toBe(true);
      expect(runtimeConfig.instructions as string[]).toContain(expectedBdInstructionPath);

      const loaded = loadConfiguredInstructions(runtimeConfigPath);
      const bdSource = loaded.sources.find((source) => source.path === expectedBdInstructionPath);

      expect(bdSource?.content).toContain(sentinel);
      expect(loaded.missing).not.toContain(expectedBdInstructionPath);
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
