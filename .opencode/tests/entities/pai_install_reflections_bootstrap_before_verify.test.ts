import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

describe("Install reflections bootstrap sequencing", () => {
  test("bootstraps reflections file before verification scan", () => {
    const targetDir = mkdtempSync(path.join(tmpdir(), "pai-install-reflections-seq-"));
    const installToolPath = path.join(repoRoot, "Tools", "Install.ts");
    const sourceDir = path.join(repoRoot, ".opencode");
    const reflectionsFile = path.join(
      targetDir,
      "MEMORY",
      "LEARNING",
      "REFLECTIONS",
      "algorithm-reflections.jsonl",
    );

    try {
      const run = spawnSync(
        "bun",
        [
          installToolPath,
          "--target",
          targetDir,
          "--source",
          sourceDir,
          "--non-interactive",
          "--skills",
          "all",
          "--skills-gate-profile",
          "off",
          "--no-install-deps",
        ],
        {
          encoding: "utf8",
          shell: false,
        },
      );

      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output).toBe(0);
      expect(existsSync(reflectionsFile), output).toBe(true);
    } finally {
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
