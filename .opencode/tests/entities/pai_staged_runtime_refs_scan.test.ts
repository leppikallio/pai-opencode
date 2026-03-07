import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot =
	path.basename(process.cwd()) === ".opencode"
		? path.resolve(process.cwd(), "..")
		: process.cwd();

describe("StagedRuntimeRefsScan", () => {
	test("stages a temp runtime and verifies runtime docs", () => {
		const targetDir = mkdtempSync(
			path.join(tmpdir(), "pai-staged-runtime-refs-"),
		);
		const toolPath = path.join(repoRoot, "Tools", "StagedRuntimeRefsScan.ts");

		try {
			const run = spawnSync(
				"bun",
				[toolPath, "--target", targetDir, "--skills-gate-profile", "off"],
				{
					encoding: "utf8",
					shell: false,
				},
			);

			const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
			expect(run.status, output).toBe(0);
			expect(
				existsSync(path.join(targetDir, "skills", "skill-index.json")),
				output,
			).toBe(true);
			expect(output, output).toContain("StagedRuntimeRefsScan: OK");
		} finally {
			rmSync(targetDir, { recursive: true, force: true });
		}
	});
});
