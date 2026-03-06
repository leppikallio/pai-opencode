import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

function runInstall(args: { installToolPath: string; sourceDir: string; targetDir: string }) {
  return spawnSync(
    "bun",
    [
      args.installToolPath,
      "--target",
      args.targetDir,
      "--source",
      args.sourceDir,
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
    },
  );
}

describe("Install MEMORY README overwrite behavior", () => {
  test("replaces stale target MEMORY/README.md with source-controlled README", () => {
    const targetDir = mkdtempSync(path.join(tmpdir(), "pai-install-memory-readme-"));
    const installToolPath = path.join(repoRoot, "Tools", "Install.ts");
    const sourceDir = path.join(repoRoot, ".opencode");
    const sourceReadme = path.join(sourceDir, "MEMORY", "README.md");
    const targetReadme = path.join(targetDir, "MEMORY", "README.md");

    try {
      const first = runInstall({ installToolPath, sourceDir, targetDir });
      const firstOutput = `${first.stdout ?? ""}\n${first.stderr ?? ""}`;
      expect(first.status, firstOutput).toBe(0);

      mkdirSync(path.dirname(targetReadme), { recursive: true });
      writeFileSync(targetReadme, "STALE MEMORY README\n", "utf8");

      const second = runInstall({ installToolPath, sourceDir, targetDir });
      const secondOutput = `${second.stdout ?? ""}\n${second.stderr ?? ""}`;
      expect(second.status, secondOutput).toBe(0);

      expect(existsSync(sourceReadme)).toBe(true);
      const sourceContent = readFileSync(sourceReadme, "utf8");
      const targetContent = readFileSync(targetReadme, "utf8");
      expect(targetContent).toBe(sourceContent);
    } finally {
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
