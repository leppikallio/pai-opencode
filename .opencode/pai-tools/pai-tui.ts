#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { command, oneOf, option, optional, runSafely, string } from "cmd-ts";

import { resolveServeCapableOpencodeBinary } from "../skills/PAI/Tools/opencode-binary-resolver";
import { resolveRuntimeRootFromMainScript } from "./resolveRuntimeRootFromMainScript";

const DEFAULT_START_PORT = 4096;
const DEFAULT_BIND_RETRIES = 3;
const DEFAULT_QUICK_EXIT_MS = 1200;
const LOOPBACK_HOST = "127.0.0.1";

type CompletionVisibleFallbackMode = "auto" | "on" | "off";

export interface PaiTuiRunOptions {
	dir: string;
	startPort: number;
	opencodeRoot: string;
	completionVisibleFallback: CompletionVisibleFallbackMode;
	bindRetries: number;
	writeState: boolean;
	passthroughArgs: string[];
}

export interface SpawnChildInput {
	binary: string;
	args: string[];
	env: Record<string, string>;
	cwd: string;
	port: number;
}

export interface SpawnedChild {
	pid: number | undefined;
	exited: Promise<number>;
}

export interface StateWriteInput {
	opencodeRoot: string;
	wrapperPid: number;
	childPid: number;
	port: number;
	serverUrl: string;
	opencodeBinary: string;
	cwd: string;
}

export interface PaiTuiStateV1 {
	v: 1;
	wrapperPid: number;
	childPid: number;
	port: number;
	serverUrl: string;
	opencodeRoot: string;
	opencodeBinary: string;
	cwd: string;
	startedAt: string;
	updatedAt: string;
	stale: boolean;
	previousLatestChildPid: number | null;
	previousLatestStale: boolean | null;
}

export interface PaiTuiDeps {
	resolveBinary: () => Promise<string>;
	selectFreePort: (startPort: number) => Promise<number>;
	spawnChild: (input: SpawnChildInput) => SpawnedChild;
	isPortAvailable: (port: number) => Promise<boolean>;
	writeState: (input: StateWriteInput) => Promise<PaiTuiStateV1>;
	logInfo: (line: string) => void;
	logWarn: (line: string) => void;
	nowMs: () => number;
	quickExitMs: number;
}

interface EarlyExitResult {
	exitedEarly: boolean;
	elapsedMs: number;
	exitCode: number;
}

interface BuildChildEnvInput {
	baseEnv: NodeJS.ProcessEnv;
	opencodeRoot: string;
	port: number;
	completionVisibleFallback: CompletionVisibleFallbackMode;
}

interface PassthroughSanitizationResult {
	args: string[];
	removed: string[];
}

interface ExistingStatePartial {
	childPid?: unknown;
}

const HELP_TEXT = [
	"pai-tui - start OpenCode TUI in network mode on a free port",
	"",
	"Usage:",
	"  pai-tui [wrapper options] [-- passthrough args]",
	"",
	"Wrapper options:",
	"  --dir <path>                                   Working directory for child OpenCode process",
	"  --port <n>                                     Starting port to probe for free bind",
	"  --opencode-root <path>                         OpenCode config/runtime root",
	"  --completion-visible-fallback <auto|on|off>    Fallback env behavior when cmux socket is missing",
	"  --bind-retries <n>                             Retries for rapid bind-race exits",
	"  --write-state <on|off>                         Persist pai-tui state artifacts",
	"",
	"Defaults:",
	`  --dir ${process.cwd()}`,
	`  --port ${DEFAULT_START_PORT}`,
	`  --opencode-root ${resolveRuntimeRootFromMainScript(import.meta.url)}`,
	"  --completion-visible-fallback auto",
	`  --bind-retries ${DEFAULT_BIND_RETRIES}`,
	"  --write-state on",
	"",
	"Pass extra OpenCode args after --",
	"Example: pai-tui --dir /repo -- --model gpt-5.3-codex",
].join("\n");

function envToRecord(baseEnv: NodeJS.ProcessEnv): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(baseEnv)) {
		if (value !== undefined) {
			env[key] = value;
		}
	}
	return env;
}

function normalizeInteger(
	value: number,
	flagName: string,
	minimum = 1,
): number {
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum) {
		const requirement =
			minimum === 0 ? "a non-negative integer" : "a positive integer";
		throw new Error(`${flagName} must be ${requirement}`);
	}
	return value;
}

function isLikelyValueToken(token: string | undefined): boolean {
	if (!token) return false;
	return !token.startsWith("-");
}

function parseCliArgv(argv: string[]): {
	wrapperArgv: string[];
	passthroughArgs: string[];
} {
	const separator = argv.indexOf("--");
	if (separator === -1) {
		return { wrapperArgv: [...argv], passthroughArgs: [] };
	}
	return {
		wrapperArgv: argv.slice(0, separator),
		passthroughArgs: argv.slice(separator + 1),
	};
}

function helpRequested(argv: string[]): boolean {
	return argv.includes("--help") || argv.includes("-h");
}

function tokenCanBeOptionValue(token: string | undefined): boolean {
	if (!token) return false;
	if (!token.startsWith("-")) return true;
	return /^-\d+$/.test(token);
}

function assertOptionValueProvided(argv: string[], flagName: string): void {
	const withEquals = `${flagName}=`;
	for (let idx = 0; idx < argv.length; idx += 1) {
		const token = argv[idx];

		if (token === flagName) {
			if (!tokenCanBeOptionValue(argv[idx + 1])) {
				throw new Error(`${flagName} requires a value`);
			}
			idx += 1;
			continue;
		}

		if (
			token.startsWith(withEquals) &&
			token.slice(withEquals.length).trim().length === 0
		) {
			throw new Error(`${flagName} requires a value`);
		}
	}
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "EPERM";
	}
}

async function atomicWriteJson(
	filePath: string,
	value: unknown,
): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
	await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await fs.rename(tmpPath, filePath);
}

async function readJsonIfExists(
	filePath: string,
): Promise<Record<string, unknown> | null> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: null;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return null;
		return null;
	}
}

function toExistingState(
	value: Record<string, unknown> | null,
): ExistingStatePartial | null {
	if (!value) return null;
	return { childPid: value.childPid };
}

function normalizeExitCode(code: number): number {
	if (!Number.isFinite(code) || !Number.isInteger(code)) return 1;
	return code;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function waitForEarlyExit(
	exited: Promise<number>,
	quickExitMs: number,
	nowMs: () => number,
): Promise<EarlyExitResult> {
	const startedAt = nowMs();
	const raced = await Promise.race<
		{ kind: "exit"; code: number } | { kind: "running" }
	>([
		exited.then((code) => ({ kind: "exit", code })),
		delay(quickExitMs).then(() => ({ kind: "running" })),
	]);

	if (raced.kind === "running") {
		return {
			exitedEarly: false,
			elapsedMs: nowMs() - startedAt,
			exitCode: 0,
		};
	}

	return {
		exitedEarly: true,
		elapsedMs: nowMs() - startedAt,
		exitCode: normalizeExitCode(raced.code),
	};
}

export function sanitizePassthroughArgs(
	args: string[],
): PassthroughSanitizationResult {
	const sanitized: string[] = [];
	const removed: string[] = [];

	for (let idx = 0; idx < args.length; idx += 1) {
		const token = args[idx];

		if (token === "--port" || token === "-p") {
			removed.push("--port");
			if (isLikelyValueToken(args[idx + 1])) idx += 1;
			continue;
		}

		if (token.startsWith("--port=")) {
			removed.push("--port");
			continue;
		}

		if (token === "--hostname") {
			removed.push("--hostname");
			if (isLikelyValueToken(args[idx + 1])) idx += 1;
			continue;
		}

		if (token.startsWith("--hostname=")) {
			removed.push("--hostname");
			continue;
		}

		if (token === "--mdns") {
			removed.push("--mdns");
			if (isLikelyValueToken(args[idx + 1])) idx += 1;
			continue;
		}

		if (token.startsWith("--mdns=")) {
			removed.push("--mdns");
			continue;
		}

		sanitized.push(token);
	}

	return { args: sanitized, removed };
}

export function buildChildEnv(
	input: BuildChildEnvInput,
): Record<string, string> {
	const env = envToRecord(input.baseEnv);
	const serverUrl = `http://${LOOPBACK_HOST}:${input.port}`;

	env.OPENCODE_SERVER_URL = serverUrl;
	env.OPENCODE_CONFIG_DIR = input.opencodeRoot;
	env.OPENCODE_ROOT = input.opencodeRoot;
	env.OPENCODE_CONFIG_ROOT = input.opencodeRoot;
	env.PAI_DIR = input.opencodeRoot;

	if (input.completionVisibleFallback === "on") {
		env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK = "1";
	} else if (input.completionVisibleFallback === "off") {
		delete env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK;
	} else {
		const socketPath = (env.CMUX_SOCKET_PATH ?? "").trim();
		if (!socketPath) {
			env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK = "1";
		}
	}

	return env;
}

export async function isPortAvailable(port: number): Promise<boolean> {
	return await new Promise((resolve) => {
		const server = net.createServer();
		server.unref();

		server.once("error", () => {
			resolve(false);
		});

		server.listen({ port, host: LOOPBACK_HOST, exclusive: true }, () => {
			server.close(() => {
				resolve(true);
			});
		});
	});
}

export async function findFirstAvailablePort(
	startPort: number,
): Promise<number> {
	const first = normalizeInteger(startPort, "startPort");
	for (let port = first; port <= 65535; port += 1) {
		if (await isPortAvailable(port)) {
			return port;
		}
	}
	throw new Error(`No free port found at or above ${startPort}`);
}

export async function writePaiTuiState(
	input: StateWriteInput,
): Promise<PaiTuiStateV1> {
	const stateDir = path.join(input.opencodeRoot, "MEMORY", "STATE");
	await fs.mkdir(stateDir, { recursive: true });

	const latestPath = path.join(stateDir, "pai-tui.json");
	const existing = toExistingState(await readJsonIfExists(latestPath));
	const previousChildPid =
		typeof existing?.childPid === "number" ? existing.childPid : null;
	const previousLatestStale =
		previousChildPid === null ? null : !isProcessAlive(previousChildPid);

	const nowIso = new Date().toISOString();
	const state: PaiTuiStateV1 = {
		v: 1,
		wrapperPid: input.wrapperPid,
		childPid: input.childPid,
		port: input.port,
		serverUrl: input.serverUrl,
		opencodeRoot: input.opencodeRoot,
		opencodeBinary: input.opencodeBinary,
		cwd: input.cwd,
		startedAt: nowIso,
		updatedAt: nowIso,
		stale: !isProcessAlive(input.childPid),
		previousLatestChildPid: previousChildPid,
		previousLatestStale,
	};

	const instancePath = path.join(stateDir, `pai-tui.${input.childPid}.json`);
	await atomicWriteJson(instancePath, state);
	await atomicWriteJson(latestPath, state);

	return state;
}

function defaultSpawnChild(input: SpawnChildInput): SpawnedChild {
	const child = spawn(input.binary, input.args, {
		cwd: input.cwd,
		env: input.env,
		stdio: "inherit",
	});

	const exited = new Promise<number>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => {
			resolve(normalizeExitCode(code ?? 1));
		});
	});

	return {
		pid: child.pid,
		exited,
	};
}

function defaultDeps(): PaiTuiDeps {
	return {
		resolveBinary: async () => await resolveServeCapableOpencodeBinary(),
		selectFreePort: findFirstAvailablePort,
		spawnChild: defaultSpawnChild,
		isPortAvailable,
		writeState: writePaiTuiState,
		logInfo: (line) => {
			console.log(line);
		},
		logWarn: (line) => {
			console.warn(line);
		},
		nowMs: () => Date.now(),
		quickExitMs: DEFAULT_QUICK_EXIT_MS,
	};
}

export async function runPaiTui(
	options: PaiTuiRunOptions,
	overrides: Partial<PaiTuiDeps> = {},
): Promise<number> {
	const deps = { ...defaultDeps(), ...overrides };

	const binary = await deps.resolveBinary();
	const sanitized = sanitizePassthroughArgs(options.passthroughArgs);
	if (sanitized.removed.length > 0) {
		deps.logWarn(
			`Stripped conflicting passthrough args: ${[...new Set(sanitized.removed)].join(", ")}`,
		);
	}

	let nextPortStart = normalizeInteger(options.startPort, "startPort");
	const bindRetries = Math.max(0, Math.trunc(options.bindRetries));

	for (let attempt = 0; attempt <= bindRetries; attempt += 1) {
		const port = await deps.selectFreePort(nextPortStart);
		const serverUrl = `http://${LOOPBACK_HOST}:${port}`;
		const env = buildChildEnv({
			baseEnv: process.env,
			opencodeRoot: options.opencodeRoot,
			port,
			completionVisibleFallback: options.completionVisibleFallback,
		});
		const args = [
			"--port",
			String(port),
			"--hostname",
			LOOPBACK_HOST,
			...sanitized.args,
		];

		deps.logInfo(`PAI TUI URL: ${serverUrl}`);

		let child: SpawnedChild;
		try {
			child = deps.spawnChild({
				binary,
				args,
				env,
				cwd: options.dir,
				port,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.logWarn(`Failed to spawn opencode: ${message}`);
			return 1;
		}

		if (options.writeState && typeof child.pid === "number" && child.pid > 0) {
			await deps.writeState({
				opencodeRoot: options.opencodeRoot,
				wrapperPid: process.pid,
				childPid: child.pid,
				port,
				serverUrl,
				opencodeBinary: binary,
				cwd: options.dir,
			});
		}

		let early: EarlyExitResult;
		try {
			early = await waitForEarlyExit(
				child.exited,
				deps.quickExitMs,
				deps.nowMs,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.logWarn(`OpenCode process failed before startup: ${message}`);
			return 1;
		}

		if (!early.exitedEarly) {
			try {
				const finalExit = await child.exited;
				return normalizeExitCode(finalExit);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				deps.logWarn(`OpenCode process crashed: ${message}`);
				return 1;
			}
		}

		if (early.exitCode === 0) {
			return 0;
		}

		const retriesRemain = attempt < bindRetries;
		const stillOccupied = !(await deps.isPortAvailable(port));
		const likelyBindRace = early.elapsedMs <= deps.quickExitMs && stillOccupied;

		if (retriesRemain && likelyBindRace) {
			nextPortStart = port + 1;
			deps.logWarn(
				`Rapid bind failure on port ${port}; retrying with next free port.`,
			);
			continue;
		}

		return early.exitCode;
	}

	return 1;
}

function createCliCommand() {
	return command({
		name: "pai-tui",
		args: {
			dir: option({ long: "dir", type: optional(string) }),
			port: option({ long: "port", type: optional(string) }),
			opencodeRoot: option({ long: "opencode-root", type: optional(string) }),
			completionVisibleFallback: option({
				long: "completion-visible-fallback",
				type: optional(oneOf(["auto", "on", "off"])),
			}),
			bindRetries: option({ long: "bind-retries", type: optional(string) }),
			writeState: option({
				long: "write-state",
				type: optional(oneOf(["on", "off"])),
			}),
		},
		handler: async (args) => {
			const parsedPort = normalizeInteger(
				Number.parseInt(args.port ?? String(DEFAULT_START_PORT), 10),
				"--port",
			);
			const parsedBindRetries = normalizeInteger(
				Number.parseInt(args.bindRetries ?? String(DEFAULT_BIND_RETRIES), 10),
				"--bind-retries",
				0,
			);

			const { passthroughArgs } = parseCliArgv(process.argv.slice(2));

			const exitCode = await runPaiTui({
				dir: path.resolve(args.dir ?? process.cwd()),
				startPort: parsedPort,
				opencodeRoot: path.resolve(
					args.opencodeRoot ??
						resolveRuntimeRootFromMainScript(import.meta.url),
				),
				completionVisibleFallback: (args.completionVisibleFallback ??
					"auto") as CompletionVisibleFallbackMode,
				bindRetries: parsedBindRetries,
				writeState: (args.writeState ?? "on") === "on",
				passthroughArgs,
			});

			if (exitCode !== 0) {
				process.exit(exitCode);
			}
		},
	});
}

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const { wrapperArgv } = parseCliArgv(argv);

	if (helpRequested(wrapperArgv)) {
		console.log(HELP_TEXT);
		process.exit(0);
	}

	try {
		assertOptionValueProvided(wrapperArgv, "--bind-retries");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`ERROR: ${message}`);
		process.exit(1);
	}

	const app = createCliCommand();
	runSafely(app, wrapperArgv)
		.then((result) => {
			if (result._tag === "ok") return;
			result.error.run();
		})
		.catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`ERROR: ${message}`);
			process.exit(1);
		});
}
