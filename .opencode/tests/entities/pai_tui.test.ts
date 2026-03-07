import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	buildDynamicContextSettingsPatch,
	buildChildEnv,
	findFirstAvailablePort,
	type PaiTuiDeps,
	type PaiTuiRunOptions,
	type PaiTuiStateV1,
	resolveDynamicContextMode,
	runPaiTui,
	sanitizePassthroughArgs,
	writeSettingsPatch,
	writePaiTuiState,
} from "../../pai-tools/pai-tui";
import { resolveServeCapableOpencodeBinary } from "../../skills/PAI/Tools/opencode-binary-resolver";

const repoRoot =
	path.basename(process.cwd()) === ".opencode"
		? path.resolve(process.cwd(), "..")
		: process.cwd();
const cliPath = path.join(repoRoot, ".opencode", "pai-tools", "pai-tui.ts");

function baseOptions(
	overrides: Partial<PaiTuiRunOptions> = {},
): PaiTuiRunOptions {
	return {
		dir: repoRoot,
		startPort: 4096,
		opencodeRoot: path.join(repoRoot, ".opencode"),
		dynamicContext: "on",
		completionVisibleFallback: "auto",
		gc: "off",
		gcOnStart: "on",
		gcOnExit: "on",
		gcInternalMode: "stale",
		gcInternalTtlMin: 15,
		gcMaxDeletes: 25,
		gcDeleteTimeoutMs: 5000,
		gcBudgetMs: 30000,
		bindRetries: 2,
		writeState: true,
		passthroughArgs: [],
		...overrides,
	};
}

function makeDeps(overrides: Partial<PaiTuiDeps>): PaiTuiDeps {
	const nowIso = new Date(0).toISOString();
	const stateRecord: PaiTuiStateV1 = {
		v: 1,
		wrapperPid: 1000,
		childPid: 1001,
		port: 4096,
		serverUrl: "http://127.0.0.1:4096",
		opencodeRoot: path.join(repoRoot, ".opencode"),
		opencodeBinary: "opencode",
		cwd: repoRoot,
		startedAt: nowIso,
		updatedAt: nowIso,
		stale: false,
		previousLatestChildPid: null,
		previousLatestStale: null,
	};

	return {
		resolveBinary: async () => "opencode",
		selectFreePort: async (start) => start,
		spawnChild: () => ({ pid: 1001, exited: Promise.resolve(0) }),
		isPortAvailable: async () => true,
		runOpencodeCli: async () => ({ exitCode: 0, stdout: "[]", stderr: "" }),
		writeSettingsPatch: async () => undefined,
		writeState: async () => stateRecord,
		logInfo: () => undefined,
		logWarn: () => undefined,
		nowMs: () => Date.now(),
		quickExitMs: 100,
		...overrides,
	};
}

	describe("pai-tui wrapper", () => {
	test("shared serve-capable resolver remains available from PAI tools", () => {
		expect(typeof resolveServeCapableOpencodeBinary).toBe("function");
	});

	test("port selection increments when occupied", async () => {
		const blocker = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch() {
				return new Response("ok");
			},
		});

		try {
			const basePort = blocker.port;
			if (typeof basePort !== "number" || basePort <= 0) {
				throw new Error("Expected Bun.serve to assign a positive port");
			}
			const selected = await findFirstAvailablePort(basePort);
			expect(selected).toBeGreaterThan(basePort);
		} finally {
			blocker.stop(true);
		}
	});

	test("produced env contains required variables", () => {
		const env = buildChildEnv({
			baseEnv: { TEST_FLAG: "1" },
			opencodeRoot: "/tmp/opencode-root",
			port: 4222,
			completionVisibleFallback: "auto",
			codexCleanSlate: undefined,
		});

		expect(env.OPENCODE_SERVER_URL).toBe("http://127.0.0.1:4222");
		expect(env.OPENCODE_CONFIG_DIR).toBe("/tmp/opencode-root");
		expect(env.OPENCODE_ROOT).toBe("/tmp/opencode-root");
		expect(env.OPENCODE_CONFIG_ROOT).toBe("/tmp/opencode-root");
		expect(env.PAI_DIR).toBe("/tmp/opencode-root");
		expect(env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK).toBe("1");
		expect(env.TEST_FLAG).toBe("1");
	});

	test("inherits PAI_CODEX_CLEAN_SLATE when codex flag is omitted", () => {
		const inherited = buildChildEnv({
			baseEnv: { PAI_CODEX_CLEAN_SLATE: "1" },
			opencodeRoot: "/tmp/opencode-root",
			port: 4222,
			completionVisibleFallback: "auto",
			codexCleanSlate: undefined,
		});

		const unset = buildChildEnv({
			baseEnv: {},
			opencodeRoot: "/tmp/opencode-root",
			port: 4222,
			completionVisibleFallback: "auto",
			codexCleanSlate: undefined,
		});

		expect(inherited.PAI_CODEX_CLEAN_SLATE).toBe("1");
		expect(unset.PAI_CODEX_CLEAN_SLATE).toBeUndefined();
	});

	test("maps --codex-clean-slate=on to PAI_CODEX_CLEAN_SLATE=1", () => {
		const env = buildChildEnv({
			baseEnv: {},
			opencodeRoot: "/tmp/opencode-root",
			port: 4222,
			completionVisibleFallback: "auto",
			codexCleanSlate: "on",
		});

		expect(env.PAI_CODEX_CLEAN_SLATE).toBe("1");
	});

	test("maps --codex-clean-slate=off to PAI_CODEX_CLEAN_SLATE=0", () => {
		const env = buildChildEnv({
			baseEnv: { PAI_CODEX_CLEAN_SLATE: "1" },
			opencodeRoot: "/tmp/opencode-root",
			port: 4222,
			completionVisibleFallback: "auto",
			codexCleanSlate: "off",
		});

		expect(env.PAI_CODEX_CLEAN_SLATE).toBe("0");
	});

	test("dynamic context mode defaults to on", () => {
		expect(resolveDynamicContextMode(undefined)).toBe("on");
		expect(resolveDynamicContextMode("off")).toBe("off");
		expect(buildDynamicContextSettingsPatch("on")).toEqual({
			dynamicContext: true,
		});
		expect(buildDynamicContextSettingsPatch("off")).toEqual({
			dynamicContext: false,
		});
	});

	test("persists dynamic context settings patch into target runtime root", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-tui-settings-"));
		try {
			await fs.writeFile(
				path.join(root, "settings.json"),
				`${JSON.stringify({ theme: "dark", dynamicContext: true }, null, 2)}\n`,
				"utf8",
			);

			await writeSettingsPatch(root, { dynamicContext: false });

			const settings = JSON.parse(
				await fs.readFile(path.join(root, "settings.json"), "utf8"),
			) as Record<string, unknown>;
			expect(settings.theme).toBe("dark");
			expect(settings.dynamicContext).toBe(false);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test("does not clobber existing malformed settings.json", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-tui-settings-"));
		const settingsPath = path.join(root, "settings.json");
		const malformed = "{\n  \"dynamicContext\": tru\n}\n";

		try {
			await fs.writeFile(settingsPath, malformed, "utf8");

			await expect(
				writeSettingsPatch(root, { dynamicContext: false }),
			).rejects.toThrow("Invalid JSON in existing settings.json");

			expect(await fs.readFile(settingsPath, "utf8")).toBe(malformed);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test("fails visibly when existing settings.json is unreadable", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-tui-settings-"));
		const settingsPath = path.join(root, "settings.json");

		try {
			await fs.mkdir(settingsPath, { recursive: true });

			await expect(
				writeSettingsPatch(root, { dynamicContext: false }),
			).rejects.toThrow("Unable to read existing settings.json");
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test("enables PAI_CMUX_DEBUG when CMUX_SOCKET_PATH is present", () => {
		const env = buildChildEnv({
			baseEnv: { CMUX_SOCKET_PATH: "/tmp/cmux.sock" },
			opencodeRoot: "/tmp/opencode-root",
			port: 4222,
			completionVisibleFallback: "auto",
			codexCleanSlate: undefined,
		});

		expect(env.PAI_CMUX_DEBUG).toBe("1");
		expect(env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK).toBeUndefined();
	});

	test("retries on bind-race failures and is bounded", async () => {
		const attemptedPorts: number[] = [];
		let launches = 0;

		const firstExit = Promise.resolve(1);
		const secondExit = new Promise<number>((resolve) => {
			setTimeout(() => resolve(0), 60);
		});

		const exitCode = await runPaiTui(
			baseOptions({ startPort: 5000, bindRetries: 1, writeState: false }),
			makeDeps({
				selectFreePort: async (start) => start,
				spawnChild: ({ port }) => {
					attemptedPorts.push(port);
					launches += 1;
					if (launches === 1) return { pid: 2001, exited: firstExit };
					return { pid: 2002, exited: secondExit };
				},
				isPortAvailable: async (port) => port !== 5000,
				quickExitMs: 10,
			}),
		);

		expect(exitCode).toBe(0);
		expect(attemptedPorts).toEqual([5000, 5001]);
	});

		test("forwards child exit code", async () => {
		const exitCode = await runPaiTui(
			baseOptions({ writeState: false }),
			makeDeps({
				spawnChild: () => ({
					pid: 3333,
					exited: new Promise<number>((resolve) => {
						setTimeout(() => resolve(7), 60);
					}),
				}),
				quickExitMs: 10,
			}),
		);

		expect(exitCode).toBe(7);
	});

	test("strips conflicting passthrough args", () => {
		const result = sanitizePassthroughArgs([
			"--theme",
			"compact",
			"--port",
			"9999",
			"--hostname=0.0.0.0",
			"--mdns",
			"on",
			"--agent",
			"fast",
		]);

		expect(result.args).toEqual(["--theme", "compact", "--agent", "fast"]);
		expect(result.removed.length).toBe(3);
	});

	test("creates MEMORY/STATE and writes per-instance plus latest state", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-tui-state-"));
		try {
			const record = await writePaiTuiState({
				opencodeRoot: root,
				wrapperPid: 111,
				childPid: 222,
				port: 5123,
				serverUrl: "http://127.0.0.1:5123",
				opencodeBinary: "opencode",
				cwd: repoRoot,
			});

			const stateDir = path.join(root, "MEMORY", "STATE");
			const instancePath = path.join(stateDir, "pai-tui.222.json");
			const latestPath = path.join(stateDir, "pai-tui.json");

			const instance = JSON.parse(
				await fs.readFile(instancePath, "utf8"),
			) as Record<string, unknown>;
			const latest = JSON.parse(
				await fs.readFile(latestPath, "utf8"),
			) as Record<string, unknown>;

			const expectedShape = {
				v: 1,
				wrapperPid: 111,
				childPid: 222,
				port: 5123,
				serverUrl: "http://127.0.0.1:5123",
				opencodeRoot: root,
				opencodeBinary: "opencode",
				cwd: repoRoot,
				previousLatestChildPid: null,
				previousLatestStale: null,
			};

			expect(record).toMatchObject(expectedShape);
			expect(instance).toMatchObject(expectedShape);
			expect(latest).toMatchObject(expectedShape);

			for (const candidate of [
				record,
				instance as unknown as PaiTuiStateV1,
				latest as unknown as PaiTuiStateV1,
			]) {
				expect(typeof candidate.stale).toBe("boolean");
				expect(typeof candidate.startedAt).toBe("string");
				expect(typeof candidate.updatedAt).toBe("string");
				expect(Number.isNaN(Date.parse(candidate.startedAt))).toBe(false);
				expect(Number.isNaN(Date.parse(candidate.updatedAt))).toBe(false);
			}

			expect(instance).toEqual(latest);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

		test("help output is explicit about options and passthrough", async () => {
			const proc = Bun.spawn({
				cmd: ["bun", cliPath, "--help"],
				cwd: repoRoot,
				env: { ...process.env },
				stdout: "pipe",
				stderr: "pipe",
			});

			const stdout = await new Response(proc.stdout).text();
			const stderr = await new Response(proc.stderr).text();
			const exit = await proc.exited;

		expect(exit).toBe(0);
		expect(stderr.trim()).toBe("");
		expect(stdout).toContain("--dir <path>");
		expect(stdout).toContain("--port <n>");
		expect(stdout).toContain("--opencode-root <path>");
		expect(stdout).toContain("--completion-visible-fallback <auto|on|off>");
		expect(stdout).toContain("--codex-clean-slate <on|off>");
		expect(stdout).toContain("--dynamic-context <on|off>");
		expect(stdout).toContain("--gc <on|off>");
		expect(stdout).toContain("--gc-on-start <on|off>");
		expect(stdout).toContain("--gc-on-exit <on|off>");
		expect(stdout).toContain("--gc-internal-mode <stale|all>");
		expect(stdout).toContain("--gc-internal-ttl-min <n>");
		expect(stdout).toContain("--gc-max-deletes <n>");
		expect(stdout).toContain("--gc-delete-timeout-ms <n>");
		expect(stdout).toContain("--gc-budget-ms <n>");
		expect(stdout).toContain("--bind-retries <n>");
		expect(stdout).toContain("--write-state <on|off>");
		expect(stdout).toContain("Defaults:");
			expect(stdout).toContain("Pass extra OpenCode args after wrapper options.");
		});

		test("GC on runs session list on start+exit and deletes internal sessions", async () => {
			const runtimeRoot = await fs.mkdtemp(
				path.join(os.tmpdir(), "pai-tui-gc-"),
			);
			try {
				const calls: string[] = [];
				let listCalls = 0;

				const exitCode = await runPaiTui(
					baseOptions({
						opencodeRoot: runtimeRoot,
						writeState: false,
						gc: "on",
						gcOnStart: "on",
						gcOnExit: "on",
						gcInternalMode: "all",
						gcInternalTtlMin: 0,
						gcMaxDeletes: 10,
						gcBudgetMs: 1000,
					}),
					makeDeps({
						spawnChild: () => ({ pid: 4444, exited: Promise.resolve(0) }),
						runOpencodeCli: async (input) => {
							calls.push(input.args.join(" "));
							if (input.args[0] === "session" && input.args[1] === "list") {
								listCalls += 1;
								const payload =
									listCalls === 1
										? [
												{
													id: "ses_internal",
													title: "[PAI INTERNAL] ImplicitSentiment",
													created: 0,
													updated: 0,
												},
											]
										: [];
								return {
									exitCode: 0,
									stdout: `${JSON.stringify(payload)}\n`,
									stderr: "",
								};
							}
							return { exitCode: 0, stdout: "", stderr: "" };
						},
						logInfo: () => undefined,
						logWarn: () => undefined,
						nowMs: () => 0,
						quickExitMs: 10,
					}),
				);

				expect(exitCode).toBe(0);
				expect(
					calls.filter((c) => c.startsWith("session list")).length,
				).toBe(2);
				expect(
					calls.filter((c) => c.startsWith("session delete ses_internal"))
						.length,
				).toBe(1);
			} finally {
				await fs.rm(runtimeRoot, { recursive: true, force: true });
			}
		});

	test("forwards unknown args to opencode (e.g. -s SESSION)", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-tui-fwd-"));
		const binPath = path.join(root, "opencode");
		const stateDir = path.join(root, "state");
		await fs.mkdir(stateDir, { recursive: true });

		await fs.writeFile(
			binPath,
			[
				"#!/usr/bin/env node",
				"const args = process.argv.slice(2);",
				"if (args.includes('--version')) process.exit(0);",
				"if (args[0] === 'serve' && args.includes('--help')) process.exit(0);",
				"process.stdout.write('FAKE_OPENCODE_ARGS=' + JSON.stringify(args) + '\\n');",
				"process.exit(0);",
			].join("\n"),
			"utf8",
		);
		await fs.chmod(binPath, 0o755);

		const proc = Bun.spawn({
			cmd: [
				"bun",
				cliPath,
				"--opencode-root",
				stateDir,
				"--write-state",
				"off",
				"--gc",
				"off",
				"-s",
				"ses_test_123",
			],
			cwd: repoRoot,
			env: {
				...process.env,
				PAI_OPENCODE_BIN: binPath,
			},
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const exit = await proc.exited;

		try {
			expect(exit).toBe(0);
			expect(stderr.trim()).toBe("");
			const marker = stdout
				.split("\n")
				.find((line) => line.startsWith("FAKE_OPENCODE_ARGS="));
			expect(marker).toBeDefined();
			const raw = (marker ?? "").slice("FAKE_OPENCODE_ARGS=".length);
			const argv = JSON.parse(raw) as unknown;
			expect(argv).toBeInstanceOf(Array);
			expect(argv).toContain("-s");
			expect(argv).toContain("ses_test_123");
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test("--dynamic-context=off persists settings.json patch in target opencode root", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-tui-dctx-"));
		const binPath = path.join(root, "opencode");
		const runtimeRoot = path.join(root, "runtime");
		const projectDir = await fs.mkdtemp(path.join(root, "project-"));
		await fs.mkdir(runtimeRoot, { recursive: true });

		await fs.writeFile(
			binPath,
			[
				"#!/usr/bin/env node",
				"const args = process.argv.slice(2);",
				"if (args.includes('--version')) process.exit(0);",
				"if (args[0] === 'serve' && args.includes('--help')) process.exit(0);",
				"process.exit(0);",
			].join("\n"),
			"utf8",
		);
		await fs.chmod(binPath, 0o755);

		const proc = Bun.spawn({
			cmd: [
				"bun",
				cliPath,
				"--opencode-root",
				runtimeRoot,
				"--write-state",
				"off",
				"--gc",
				"off",
				"--dynamic-context",
				"off",
			],
			cwd: repoRoot,
			env: {
				...process.env,
				PAI_OPENCODE_BIN: binPath,
			},
			stdout: "pipe",
			stderr: "pipe",
		});

		const stderr = await new Response(proc.stderr).text();
		const exit = await proc.exited;

		try {
			expect(exit).toBe(0);
			expect(stderr.trim()).toBe("");
			const settings = JSON.parse(
				await fs.readFile(path.join(runtimeRoot, "settings.json"), "utf8"),
			) as Record<string, unknown>;
			expect(settings.dynamicContext).toBe(false);

			const loadContextBaseEnv = Object.fromEntries(
				Object.entries(process.env).filter(
					([key]) => !key.startsWith("CLAUDE_") && !key.startsWith("OPENCODE_"),
				),
			);

			const runLoadContext = async (): Promise<{
				exit: number;
				stdout: string;
				stderr: string;
			}> => {
				const loadContextProc = Bun.spawn({
					cmd: ["bun", ".opencode/hooks/LoadContext.hook.ts"],
					cwd: repoRoot,
					env: {
						...loadContextBaseEnv,
						OPENCODE_AGENT_TYPE: "",
						OPENCODE_PROJECT_DIR: projectDir,
						OPENCODE_ROOT: runtimeRoot,
					},
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
				});

				loadContextProc.stdin.end();
				const loadContextStdout = await new Response(loadContextProc.stdout).text();
				const loadContextStderr = await new Response(loadContextProc.stderr).text();
				const loadContextExit = await loadContextProc.exited;

				return {
					exit: loadContextExit,
					stdout: loadContextStdout,
					stderr: loadContextStderr,
				};
			};

			const disabled = await runLoadContext();
			expect(disabled.exit).toBe(0);
			expect(disabled.stdout).toBe("");
			expect(disabled.stderr).toBe("");

			await writeSettingsPatch(runtimeRoot, { dynamicContext: true });
			const enabled = await runLoadContext();
			expect(enabled.exit).toBe(0);
			expect(enabled.stderr).toBe("");
			expect(enabled.stdout).toContain("&lt;dynamic-context&gt;");
			expect(enabled.stdout.trim().length).toBeGreaterThan(0);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test("rejects --bind-retries when value is missing", async () => {
		const proc = Bun.spawn({
			cmd: ["bun", cliPath, "--bind-retries"],
			cwd: repoRoot,
			env: { ...process.env },
			stdout: "pipe",
			stderr: "pipe",
		});

		const stderr = await new Response(proc.stderr).text();
		const exit = await proc.exited;

		expect(exit).toBe(1);
		expect(stderr).toContain("--bind-retries requires a value");
	});

	test("rejects --dynamic-context when value is missing", async () => {
		const proc = Bun.spawn({
			cmd: ["bun", cliPath, "--dynamic-context"],
			cwd: repoRoot,
			env: { ...process.env },
			stdout: "pipe",
			stderr: "pipe",
		});

		const stderr = await new Response(proc.stderr).text();
		const exit = await proc.exited;

		expect(exit).toBe(1);
		expect(stderr).toContain("--dynamic-context requires a value");
	});

	test("rejects --codex-clean-slate when value is missing", async () => {
		const proc = Bun.spawn({
			cmd: ["bun", cliPath, "--codex-clean-slate"],
			cwd: repoRoot,
			env: { ...process.env },
			stdout: "pipe",
			stderr: "pipe",
		});

		const stderr = await new Response(proc.stderr).text();
		const exit = await proc.exited;

		expect(exit).toBe(1);
		expect(stderr).toContain("--codex-clean-slate requires a value");
	});

	test("rejects --dynamic-context invalid enum value", async () => {
		const proc = Bun.spawn({
			cmd: ["bun", cliPath, "--dynamic-context", "maybe"],
			cwd: repoRoot,
			env: { ...process.env },
			stdout: "pipe",
			stderr: "pipe",
		});

		const stderr = await new Response(proc.stderr).text();
		const exit = await proc.exited;

		expect(exit).toBe(1);
		expect(stderr).toContain("--dynamic-context");
		expect(stderr).toContain("Invalid value 'maybe'");
	});
});
