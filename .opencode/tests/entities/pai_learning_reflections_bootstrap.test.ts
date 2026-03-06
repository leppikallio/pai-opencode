import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureLearningReflectionsArtifacts } from "../../../Tools/pai-install/ensure-learning-reflections";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

describe("learning reflections bootstrap helper", () => {
  test("creates reflections artifacts, is idempotent, and preserves existing contents", () => {
    const runtimeRoot = mkdtempSync(path.join(tmpdir(), "pai-reflections-bootstrap-"));
    const reflectionsDir = path.join(runtimeRoot, "MEMORY", "LEARNING", "REFLECTIONS");
    const reflectionsFile = path.join(reflectionsDir, "algorithm-reflections.jsonl");

    try {
      expect(existsSync(reflectionsFile)).toBe(false);

      ensureLearningReflectionsArtifacts({ targetDir: runtimeRoot, dryRun: false });

      expect(existsSync(reflectionsDir)).toBe(true);
      expect(existsSync(reflectionsFile)).toBe(true);
      expect(readFileSync(reflectionsFile, "utf8")).toBe("");

      const existingContent = '{"timestamp":"2026-03-06T00:00:00.000Z","note":"keep"}\n';
      writeFileSync(reflectionsFile, existingContent, "utf8");

      ensureLearningReflectionsArtifacts({ targetDir: runtimeRoot, dryRun: false });

      expect(readFileSync(reflectionsFile, "utf8")).toBe(existingContent);
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});
