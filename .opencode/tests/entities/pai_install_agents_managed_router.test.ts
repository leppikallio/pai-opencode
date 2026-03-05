import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const installToolPath = path.join(repoRoot, "Tools", "Install.ts");
const sourceDir = path.join(repoRoot, ".opencode");
const blockBegin = "<!-- PAI-OPENCODE:BEGIN -->";
const blockEnd = "<!-- PAI-OPENCODE:END -->";

test("Install managed AGENTS block includes PAI Router section", () => {
  const targetDir = mkdtempSync(path.join(tmpdir(), "pai-install-router-"));

  try {
    const run = spawnSync(
      "bun",
      [
        installToolPath,
        "--target",
        targetDir,
        "--source",
        sourceDir,
        "--dry-run",
        "--non-interactive",
        "--skills",
        "all",
        "--skills-gate-profile",
        "off",
        "--no-verify",
        "--no-install-deps",
      ],
      {
        encoding: "utf8",
        shell: false,
      },
    );

    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    expect(run.status, output).toBe(0);

    const begin = output.indexOf(blockBegin);
    const end = output.indexOf(blockEnd);
    expect(begin, output).toBeGreaterThanOrEqual(0);
    expect(end, output).toBeGreaterThan(begin);

    const block = output.slice(begin, end + blockEnd.length);
    expect(block).toContain("## PAI Router (Managed)");
    expect(block).toContain("Mode selection: MINIMAL / NATIVE / ALGORITHM.");
		expect(block).toContain("One response = one mode. Do not mix modes in a single response.");
		expect(block).toContain("/skills/PAI/Components/Algorithm/LATEST");
		expect(block).toMatch(/\/skills\/PAI\/Components\/Algorithm\/v\d+\.\d+\.\d+\.md/);
		expect(block).toContain("/skills/PAI/CONTEXT_ROUTING.md");
		expect(block).toContain("/skills/PAI/SKILL.md");
		expect(block).toContain("unless needed");
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});
