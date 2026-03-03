import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	buildChildEnv,
	findFirstAvailablePort,
	type PaiTuiDeps,
	type PaiTuiRunOptions,
	type PaiTuiStateV1,
	runPaiTui,
	sanitizePassthroughArgs,
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
		completionVisibleFallback: "auto",
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
		});

		expect(env.OPENCODE_SERVER_URL).toBe("http://127.0.0.1:4222");
		expect(env.OPENCODE_CONFIG_DIR).toBe("/tmp/opencode-root");
		expect(env.OPENCODE_ROOT).toBe("/tmp/opencode-root");
		expect(env.OPENCODE_CONFIG_ROOT).toBe("/tmp/opencode-root");
		expect(env.PAI_DIR).toBe("/tmp/opencode-root");
		expect(env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK).toBe("1");
		expect(env.TEST_FLAG).toBe("1");
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

			expect(record.v).toBe(1);
			expect(record.wrapperPid).toBe(111);
			expect(record.childPid).toBe(222);
			expect(instance.v).toBe(1);
			expect(instance.wrapperPid).toBe(111);
			expect(instance.childPid).toBe(222);
			expect(latest.childPid).toBe(222);
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
		expect(stdout).toContain("--bind-retries <n>");
		expect(stdout).toContain("--write-state <on|off>");
		expect(stdout).toContain("Defaults:");
		expect(stdout).toContain("Pass extra OpenCode args after --");
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
});
