import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot =
	path.basename(process.cwd()) === ".opencode"
		? path.resolve(process.cwd(), "..")
		: process.cwd();

describe("ScanBrokenRefs runtime-root handling", () => {
	test("resolves ~/.config/opencode references against --root runtime", () => {
		const runtimeRoot = mkdtempSync(
			path.join(tmpdir(), "pai-scan-broken-refs-root-"),
		);
		const fakeHome = mkdtempSync(
			path.join(tmpdir(), "pai-scan-broken-refs-home-"),
		);

		try {
			const scopeDir = path.join(runtimeRoot, "skills");
			const skillDir = path.join(scopeDir, "system");
			const reflectionsDir = path.join(
				runtimeRoot,
				"MEMORY",
				"LEARNING",
				"REFLECTIONS",
			);
			const reflectionsFile = path.join(
				reflectionsDir,
				"algorithm-reflections.jsonl",
			);
			const scanToolPath = path.join(
				repoRoot,
				".opencode",
				"skills",
				"system",
				"Tools",
				"ScanBrokenRefs.ts",
			);

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
			const withFileParsed = JSON.parse(withFile.stdout || "{}") as {
				count?: number;
			};
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
			expect(missingFileParsed.findings?.[0]?.resolved, missingFileOutput).toBe(
				reflectionsFile,
			);
		} finally {
			rmSync(runtimeRoot, { recursive: true, force: true });
			rmSync(fakeHome, { recursive: true, force: true });
		}
	});

	test("suppresses install-generated runtime refs when scanning source .opencode tree", () => {
		const tempParent = mkdtempSync(
			path.join(tmpdir(), "pai-scan-broken-refs-source-"),
		);
		const sourceRoot = path.join(tempParent, ".opencode");
		const skillDir = path.join(sourceRoot, "skills", "system");
		const fakeHome = mkdtempSync(
			path.join(tmpdir(), "pai-scan-broken-refs-home-"),
		);
		const scanToolPath = path.join(
			repoRoot,
			".opencode",
			"skills",
			"system",
			"Tools",
			"ScanBrokenRefs.ts",
		);

		try {
			mkdirSync(skillDir, { recursive: true });

			writeFileSync(
				path.join(skillDir, "SKILL.md"),
				[
					"# source scan check",
					"",
					"Ref: `~/.config/opencode/MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl`",
					"Ref: `~/.config/opencode/opencode.json`",
					"Ref: `~/.config/opencode/skills/skill-index.json`",
					"Ref: `~/.config/opencode/VoiceServer/server.ts`",
					"",
				].join("\n"),
				"utf8",
			);

			const run = spawnSync(
				"bun",
				[
					scanToolPath,
					"--root",
					sourceRoot,
					"--scope",
					path.join(sourceRoot, "skills"),
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

			const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
			expect(run.status, output).toBe(0);
			const parsed = JSON.parse(run.stdout || "{}") as { count?: number };
			expect(parsed.count, output).toBe(0);
		} finally {
			rmSync(tempParent, { recursive: true, force: true });
			rmSync(fakeHome, { recursive: true, force: true });
		}
	});
});
