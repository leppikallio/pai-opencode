import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadConfiguredInstructions } from "../../plugins/handlers/prompt-sources";
import { createRtkShim, prependPath, runInstall } from "./pai_install_runtime_test_helpers";

describe("prompt-sources RTK runtime doc loading (Task 3 contract)", () => {
  test("installs Task 3 RTK.md semantic source-of-truth contract", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-prompt-sources-rtk-baseline-"));
    const shimDir = createRtkShim({
      versionOutput: "rtk 0.23.0",
      tempPrefix: "pai-prompt-sources-rtk-shim-",
    });

    try {
      const run = runInstall({
        targetDir,
        pathValue: prependPath(shimDir),
      });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output).toBe(0);

      const runtimeRtkPath = path.join(targetDir, "RTK.md");
      const runtimeRtkDoc = readFileSync(runtimeRtkPath, "utf8");

      expect(runtimeRtkDoc).toContain("RTK may rewrite shell commands transparently");
      expect(runtimeRtkDoc).toContain("`git status` -> `rtk git status`");
      expect(runtimeRtkDoc).toContain("RTK-proxied output is authoritative by default");
      expect(runtimeRtkDoc).toContain("Shorter optimized output is normal");
      expect(runtimeRtkDoc).toContain("The `rtk` prefix is expected and normal");
      expect(runtimeRtkDoc).toContain("Meta Commands (always use rtk directly)");
      expect(runtimeRtkDoc).toContain("Raw-output/tee recovery is an exception path");
      expect(runtimeRtkDoc).toContain("If RTK emits a `[full output: ~/.local/share/rtk/tee/... ]` hint");
      expect(runtimeRtkDoc).toContain("Read ~/.local/share/rtk/tee/<file>");
      expect(runtimeRtkDoc).toContain("rtk proxy cat ~/.local/share/rtk/tee/<file>");
      expect(runtimeRtkDoc).toContain("Do not rerun raw commands outside RTK by default");
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });

  test("loadConfiguredInstructions loads runtime RTK.md from canonical absolute string instructions", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "pai-prompt-sources-rtk-runtime-"));
    const shimDir = createRtkShim({
      versionOutput: "rtk 0.23.0",
      tempPrefix: "pai-prompt-sources-rtk-shim-",
    });

    try {
      const run = runInstall({
        targetDir,
        pathValue: prependPath(shimDir),
      });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output).toBe(0);

      const runtimeConfigPath = path.join(targetDir, "opencode.json");
      const expectedRtkInstructionPath = path.join(targetDir, "RTK.md");
      const sentinel = "RTK_PROMPT_SOURCES_RUNTIME_SENTINEL_TASK1";

      writeFileSync(expectedRtkInstructionPath, `${sentinel}\n`, "utf8");

      const runtimeConfig = JSON.parse(readFileSync(runtimeConfigPath, "utf8")) as {
        instructions?: unknown;
      };

      expect(Array.isArray(runtimeConfig.instructions)).toBe(true);
      expect(
        (runtimeConfig.instructions as unknown[]).every((entry) => typeof entry === "string"),
      ).toBe(true);
      expect(runtimeConfig.instructions as string[]).toContain(expectedRtkInstructionPath);

      const loaded = loadConfiguredInstructions(runtimeConfigPath);
      const rtkSource = loaded.sources.find((source) => source.path === expectedRtkInstructionPath);

      expect(rtkSource?.content).toContain(sentinel);
      expect(loaded.missing).not.toContain(expectedRtkInstructionPath);
    } finally {
      rmSync(shimDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
