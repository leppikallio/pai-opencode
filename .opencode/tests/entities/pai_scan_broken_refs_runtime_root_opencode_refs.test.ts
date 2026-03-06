import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

describe("ScanBrokenRefs runtime-root handling", () => {
  test("resolves ~/.config/opencode references against --root runtime", () => {
    const runtimeRoot = mkdtempSync(path.join(tmpdir(), "pai-scan-broken-refs-root-"));
    const fakeHome = mkdtempSync(path.join(tmpdir(), "pai-scan-broken-refs-home-"));

    try {
      const scopeDir = path.join(runtimeRoot, "skills");
      const skillDir = path.join(scopeDir, "system");
      const reflectionsDir = path.join(runtimeRoot, "MEMORY", "LEARNING", "REFLECTIONS");
      const reflectionsFile = path.join(reflectionsDir, "algorithm-reflections.jsonl");
      const scanToolPath = path.join(repoRoot, ".opencode", "skills", "system", "Tools", "ScanBrokenRefs.ts");

      mkdirSync(skillDir, { recursive: true });
      mkdirSync(reflectionsDir, { recursive: true });

      writeFileSync(
        path.join(skillDir, "SKILL.md"),
        [
          "# scan check",
          "",
          "Ref: `~/.config/opencode/MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl`",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(reflectionsFile, "", "utf8");

      const runScan = () =>
        spawnSync(
          "bun",
          [
            scanToolPath,
            "--root",
            runtimeRoot,
            "--scope",
            scopeDir,
            "--format",
            "json",
            "--allow-standalone",
          ],
          {
            encoding: "utf8",
            shell: false,
            env: {
              ...process.env,
              HOME: fakeHome,
            },
          },
        );

      const withFile = runScan();
      const withFileOutput = `${withFile.stdout ?? ""}\n${withFile.stderr ?? ""}`;
      expect(withFile.status, withFileOutput).toBe(0);
      const withFileParsed = JSON.parse(withFile.stdout || "{}") as { count?: number };
      expect(withFileParsed.count, withFileOutput).toBe(0);

      unlinkSync(reflectionsFile);

      const missingFile = runScan();
      const missingFileOutput = `${missingFile.stdout ?? ""}\n${missingFile.stderr ?? ""}`;
      expect(missingFile.status, missingFileOutput).toBe(0);
      const missingFileParsed = JSON.parse(missingFile.stdout || "{}") as {
        count?: number;
        findings?: Array<{ resolved?: string }>;
      };
      expect(missingFileParsed.count, missingFileOutput).toBe(1);
      expect(missingFileParsed.findings?.[0]?.resolved, missingFileOutput).toBe(reflectionsFile);
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
