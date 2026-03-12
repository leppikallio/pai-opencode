import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
	? path.resolve(process.cwd(), "..")
	: process.cwd();

function withEnv(overrides: Record<string, string | undefined>): Record<string, string> {
	const env: Record<string, string> = {};

	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) {
			env[key] = value;
		}
	}

	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) {
			delete env[key];
			continue;
		}

		env[key] = value;
	}

	return env;
}

function withPrependedPath(binDir: string): string {
	const basePath = process.env.PATH;
	if (!basePath) {
		return binDir;
	}

	return `${binDir}:${basePath}`;
}

async function runBeadsPrimeHook(args: {
	runtimeRoot: string;
	cwd: string;
	stdin: Record<string, unknown>;
	env?: Record<string, string | undefined>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdinPayload = {
		...args.stdin,
		cwd: args.cwd,
	};

	const proc = Bun.spawn({
		cmd: [process.execPath, ".opencode/hooks/BeadsPrime.hook.ts"],
		cwd: repoRoot,
		env: withEnv({
			...args.env,
			OPENCODE_ROOT: args.runtimeRoot,
			OPENCODE_CONFIG_ROOT: undefined,
		}),
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	proc.stdin.write(`${JSON.stringify(stdinPayload)}\n`);
	proc.stdin.end();

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { exitCode, stdout, stderr };
}

async function createRuntimeRoot(settings?: Record<string, unknown>): Promise<string> {
	const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-precompact-runtime-"));
	await fs.writeFile(
		path.join(runtimeRoot, "settings.json"),
		`${JSON.stringify(settings ?? {}, null, 2)}\n`,
		"utf8",
	);
	return runtimeRoot;
}

async function createFakeBd(args: {
	binDir: string;
	logPath: string;
	outputPath: string;
	exitCode?: number;
}): Promise<void> {
	const scriptPath = path.join(args.binDir, "bd");
	await fs.writeFile(
		scriptPath,
		[
			"#!/bin/sh",
			`printf '%s\n' \"$*\" >> \"${args.logPath}\"`,
			"if [ \"$1\" = \"prime\" ] && [ \"$2\" = \"--stealth\" ]; then",
			"  if [ ! -d \"$PWD/.beads\" ]; then",
			"    exit 2",
			"  fi",
			`  cat \"${args.outputPath}\"`,
			`  exit ${args.exitCode ?? 0}`,
			"fi",
			"exit 0",
		].join("\n"),
		"utf8",
	);
	await fs.chmod(scriptPath, 0o755);
}

describe("BeadsPrime PreCompact hook", () => {
	test("emits reminder output for root PreCompact sessions", async () => {
		const runtimeRoot = await createRuntimeRoot();
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-precompact-workspace-"));
		const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-precompact-bin-"));
		const logPath = path.join(binDir, "calls.log");
		const outputPath = path.join(binDir, "prime.txt");

		try {
			await fs.mkdir(path.join(workspace, ".beads"), { recursive: true });
			await fs.writeFile(outputPath, "PreCompact beads context", "utf8");
			await createFakeBd({ binDir, logPath, outputPath });

			const result = await runBeadsPrimeHook({
				runtimeRoot,
				cwd: workspace,
				stdin: {
					session_id: "ses_root",
					root_session_id: "ses_root",
					hook_event_name: "PreCompact",
				},
				env: { PATH: withPrependedPath(binDir) },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("<system-reminder>");
			expect(result.stdout).toContain("PreCompact beads context");
			expect(result.stderr).toBe("");

			const callLog = await fs.readFile(logPath, "utf8");
			expect(callLog).toContain("prime --stealth");
		} finally {
			await fs.rm(binDir, { recursive: true, force: true });
			await fs.rm(workspace, { recursive: true, force: true });
			await fs.rm(runtimeRoot, { recursive: true, force: true });
		}
	});

	test("no-ops for non-root PreCompact sessions", async () => {
		const runtimeRoot = await createRuntimeRoot();
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-precompact-workspace-"));
		const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-precompact-bin-"));
		const logPath = path.join(binDir, "calls.log");
		const outputPath = path.join(binDir, "prime.txt");

		try {
			await fs.mkdir(path.join(workspace, ".beads"), { recursive: true });
			await fs.writeFile(outputPath, "should-not-run", "utf8");
			await createFakeBd({ binDir, logPath, outputPath });

			const result = await runBeadsPrimeHook({
				runtimeRoot,
				cwd: workspace,
				stdin: {
					session_id: "ses_child",
					root_session_id: "ses_root",
					hook_event_name: "PreCompact",
				},
				env: { PATH: withPrependedPath(binDir) },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
			await expect(fs.stat(logPath)).rejects.toThrow();
		} finally {
			await fs.rm(binDir, { recursive: true, force: true });
			await fs.rm(workspace, { recursive: true, force: true });
			await fs.rm(runtimeRoot, { recursive: true, force: true });
		}
	});

	test("no-ops when paiFeatures.beads=false for PreCompact", async () => {
		const runtimeRoot = await createRuntimeRoot({
			paiFeatures: { beads: false },
		});
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-precompact-workspace-"));
		const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-precompact-bin-"));
		const logPath = path.join(binDir, "calls.log");
		const outputPath = path.join(binDir, "prime.txt");

		try {
			await fs.mkdir(path.join(workspace, ".beads"), { recursive: true });
			await fs.writeFile(outputPath, "should-not-run", "utf8");
			await createFakeBd({ binDir, logPath, outputPath });

			const result = await runBeadsPrimeHook({
				runtimeRoot,
				cwd: workspace,
				stdin: {
					session_id: "ses_root",
					root_session_id: "ses_root",
					hook_event_name: "PreCompact",
				},
				env: { PATH: withPrependedPath(binDir) },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
			await expect(fs.stat(logPath)).rejects.toThrow();
		} finally {
			await fs.rm(binDir, { recursive: true, force: true });
			await fs.rm(workspace, { recursive: true, force: true });
			await fs.rm(runtimeRoot, { recursive: true, force: true });
		}
	});

	test("degrades gracefully when bd is missing for PreCompact", async () => {
		const runtimeRoot = await createRuntimeRoot();
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-precompact-workspace-"));
		const emptyPathDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-precompact-empty-path-"));

		try {
			await fs.mkdir(path.join(workspace, ".beads"), { recursive: true });

			const result = await runBeadsPrimeHook({
				runtimeRoot,
				cwd: workspace,
				stdin: {
					session_id: "ses_root",
					root_session_id: "ses_root",
					hook_event_name: "PreCompact",
				},
				env: { PATH: emptyPathDir },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
		} finally {
			await fs.rm(emptyPathDir, { recursive: true, force: true });
			await fs.rm(workspace, { recursive: true, force: true });
			await fs.rm(runtimeRoot, { recursive: true, force: true });
		}
	});

	test("degrades gracefully when bd exits non-zero for PreCompact", async () => {
		const runtimeRoot = await createRuntimeRoot();
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-precompact-workspace-"));
		const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-precompact-bin-"));
		const logPath = path.join(binDir, "calls.log");
		const outputPath = path.join(binDir, "prime.txt");

		try {
			await fs.mkdir(path.join(workspace, ".beads"), { recursive: true });
			await fs.writeFile(outputPath, "should-not-inject", "utf8");
			await createFakeBd({ binDir, logPath, outputPath, exitCode: 23 });

			const result = await runBeadsPrimeHook({
				runtimeRoot,
				cwd: workspace,
				stdin: {
					session_id: "ses_root",
					root_session_id: "ses_root",
					hook_event_name: "PreCompact",
				},
				env: { PATH: withPrependedPath(binDir) },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");

			const callLog = await fs.readFile(logPath, "utf8");
			expect(callLog).toContain("prime --stealth");
		} finally {
			await fs.rm(binDir, { recursive: true, force: true });
			await fs.rm(workspace, { recursive: true, force: true });
			await fs.rm(runtimeRoot, { recursive: true, force: true });
		}
	});
});
