import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

describe("Algorithm reflections append smoke", () => {
  test("mkdir+append shell shape writes one line and SKILL includes same contract", () => {
    const runtimeRoot = mkdtempSync(path.join(tmpdir(), "pai-reflections-append-smoke-"));
    const reflectionsDir = path.join(runtimeRoot, "MEMORY", "LEARNING", "REFLECTIONS");
    const reflectionsFile = path.join(reflectionsDir, "algorithm-reflections.jsonl");
    const payload = '{"timestamp":"2026-03-06T00:00:00.000+00:00","effort_level":"standard"}';

    try {
      const appendCommand = `mkdir -p "${reflectionsDir}" && echo '${payload}' >> "${reflectionsFile}"`;
      const run = spawnSync("bash", ["-lc", appendCommand], {
        encoding: "utf8",
        shell: false,
      });

      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output).toBe(0);

      const lines = readFileSync(reflectionsFile, "utf8")
        .split("\n")
        .filter((line) => line.length > 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(payload);

      const skillPath = path.join(repoRoot, ".opencode", "skills", "PAI", "SKILL.md");
      const skillText = readFileSync(skillPath, "utf8");
      expect(skillText).toContain("mkdir -p ~/.config/opencode/MEMORY/LEARNING/REFLECTIONS && echo");
      expect(skillText).toContain(
        ">> ~/.config/opencode/MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl",
      );
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});
