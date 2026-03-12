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
	const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-hook-runtime-"));
	const nextSettings = settings ?? {};
	await fs.writeFile(
		path.join(runtimeRoot, "settings.json"),
		`${JSON.stringify(nextSettings, null, 2)}\n`,
		"utf8",
	);
	return runtimeRoot;
}

async function createFakeBd(args: {
	binDir: string;
	logPath: string;
	outputPath: string;
}): Promise<string> {
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
			"  exit 0",
			"fi",
			"exit 0",
		].join("\n"),
		"utf8",
	);
	await fs.chmod(scriptPath, 0o755);
	return scriptPath;
}

describe("BeadsPrime SessionStart hook", () => {
	test("no-ops when settings.json has paiFeatures.beads=false", async () => {
		const runtimeRoot = await createRuntimeRoot({
			paiFeatures: { beads: false },
		});
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-hook-workspace-"));
		const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-hook-bin-"));
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
					hook_event_name: "SessionStart",
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

	test("defaults enabled, runs bd prime --stealth, and emits sanitized reminder output", async () => {
		const runtimeRoot = await createRuntimeRoot();
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-hook-workspace-"));
		const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-hook-bin-"));
		const logPath = path.join(binDir, "calls.log");
		const outputPath = path.join(binDir, "prime.txt");

		try {
			await fs.mkdir(path.join(workspace, ".beads"), { recursive: true });
			await fs.writeFile(
				outputPath,
				"Raw <beads> output with `code`\n\u0000\u0001\u0002" + "X".repeat(20000),
				"utf8",
			);
			await createFakeBd({ binDir, logPath, outputPath });

			const result = await runBeadsPrimeHook({
				runtimeRoot,
				cwd: workspace,
				stdin: {
					session_id: "ses_root",
					root_session_id: "ses_root",
					hook_event_name: "SessionStart",
				},
				env: { PATH: withPrependedPath(binDir) },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout.startsWith("<system-reminder>\n")).toBe(true);
			expect(result.stdout.endsWith("\n</system-reminder>\n")).toBe(true);
			expect(result.stdout).toContain("Raw &lt;beads&gt; output");
			expect(result.stdout).not.toContain("Raw <beads> output");
			expect(result.stdout).not.toContain("`code`");
			expect(result.stdout.length).toBeLessThanOrEqual(4100);
			expect(result.stderr).toBe("");

			const callLog = await fs.readFile(logPath, "utf8");
			expect(callLog).toContain("prime --stealth");
		} finally {
			await fs.rm(binDir, { recursive: true, force: true });
			await fs.rm(workspace, { recursive: true, force: true });
			await fs.rm(runtimeRoot, { recursive: true, force: true });
		}
	});

	test("no-ops when bd is unavailable", async () => {
		const runtimeRoot = await createRuntimeRoot();
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-hook-workspace-"));
		const emptyPathDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-hook-empty-path-"));

		try {
			await fs.mkdir(path.join(workspace, ".beads"), { recursive: true });

			const result = await runBeadsPrimeHook({
				runtimeRoot,
				cwd: workspace,
				stdin: {
					session_id: "ses_root",
					root_session_id: "ses_root",
					hook_event_name: "SessionStart",
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

	test("no-ops when cwd is not a Beads repository", async () => {
		const runtimeRoot = await createRuntimeRoot();
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-hook-workspace-"));
		const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-hook-bin-"));
		const logPath = path.join(binDir, "calls.log");
		const outputPath = path.join(binDir, "prime.txt");

		try {
			await fs.writeFile(outputPath, "should-not-run", "utf8");
			await createFakeBd({ binDir, logPath, outputPath });

			const result = await runBeadsPrimeHook({
				runtimeRoot,
				cwd: workspace,
				stdin: {
					session_id: "ses_root",
					root_session_id: "ses_root",
					hook_event_name: "SessionStart",
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

	test("no-ops for non-root sessions", async () => {
		const runtimeRoot = await createRuntimeRoot();
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-hook-workspace-"));
		const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-beads-hook-bin-"));
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
					hook_event_name: "SessionStart",
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
});
