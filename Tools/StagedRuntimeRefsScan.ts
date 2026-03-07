#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type SkillsGateProfile = "off" | "advisory" | "block-critical" | "block-high";

type Options = {
	targetDir: string;
	sourceDir: string;
	skillsGateProfile: SkillsGateProfile;
	cleanup: boolean;
};

function usage(exitCode = 0): never {
	console.log(`StagedRuntimeRefsScan

Usage:
  bun Tools/StagedRuntimeRefsScan.ts [options]

Options:
  --target <dir>                  Staging runtime root (default: temp dir)
  --source <dir>                  Source .opencode dir (default: <repo>/.opencode)
  --skills-gate-profile <profile> Skills gate profile for staged install (default: off)
  --cleanup                       Delete the staging runtime after a successful scan
  -h, --help                      Show help

Behavior:
  - stages a temp runtime install with all skills selected
  - runs Install.ts verification in that staged runtime
  - reports the staging root for inspection/follow-up
`);
	process.exit(exitCode);
}

function repoRootFromHere(): string {
	return path.resolve(path.dirname(import.meta.dir));
}

function parseArgs(argv: string[]): Options {
	const repoRoot = repoRootFromHere();

	let targetDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "pai-staged-runtime-refs-"),
	);
	let sourceDir = path.join(repoRoot, ".opencode");
	let skillsGateProfile: SkillsGateProfile = "off";
	let cleanup = false;

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];

		if (arg === "--help" || arg === "-h") {
			usage(0);
		}

		if (arg === "--target") {
			const value = argv[++index];
			if (!value) usage(2);
			targetDir = value;
			continue;
		}

		if (arg === "--source") {
			const value = argv[++index];
			if (!value) usage(2);
			sourceDir = value;
			continue;
		}

		if (arg === "--skills-gate-profile") {
			const value = argv[++index];
			if (
				value !== "off" &&
				value !== "advisory" &&
				value !== "block-critical" &&
				value !== "block-high"
			) {
				usage(2);
			}
			skillsGateProfile = value;
			continue;
		}

		if (arg === "--cleanup") {
			cleanup = true;
			continue;
		}

		usage(2);
	}

	return {
		targetDir,
		sourceDir,
		skillsGateProfile,
		cleanup,
	};
}

function runInstall(options: Options): void {
	const installToolPath = path.join(repoRootFromHere(), "Tools", "Install.ts");
	const args = [
		installToolPath,
		"--target",
		options.targetDir,
		"--source",
		options.sourceDir,
		"--skills",
		"all",
		"--non-interactive",
		"--no-install-deps",
		"--skills-gate-profile",
		options.skillsGateProfile,
	];

	const result = spawnSync("bun", args, {
		stdio: "inherit",
		shell: false,
	});

	if (result.status !== 0) {
		throw new Error(
			`Install failed with exit code ${String(result.status ?? 1)}`,
		);
	}
}

function main(): void {
	const options = parseArgs(process.argv.slice(2));

	try {
		fs.mkdirSync(options.targetDir, { recursive: true });
		runInstall(options);

		console.log(`StagedRuntimeRefsScan: OK`);
		console.log(`target: ${options.targetDir}`);

		if (options.cleanup) {
			fs.rmSync(options.targetDir, { recursive: true, force: true });
			console.log("cleanup: removed staged runtime");
		}
	} catch (error) {
		console.error(`StagedRuntimeRefsScan: FAIL\n${String(error)}`);
		process.exit(1);
	}
}

main();
