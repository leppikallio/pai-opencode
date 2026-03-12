#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import {
	command,
	oneOf,
	option,
	optional,
	rest,
	runSafely,
	string,
} from "cmd-ts";

import { resolveServeCapableOpencodeBinary } from "../skills/PAI/Tools/opencode-binary-resolver";
import { resolveRuntimeRootFromMainScript } from "./resolveRuntimeRootFromMainScript";

const DEFAULT_START_PORT = 4096;
const DEFAULT_BIND_RETRIES = 3;
const DEFAULT_QUICK_EXIT_MS = 1200;
const DEFAULT_GC = "on" satisfies GarbageCollectMode;
const DEFAULT_GC_ON_START = "on" satisfies GarbageCollectMode;
const DEFAULT_GC_ON_EXIT = "on" satisfies GarbageCollectMode;
const DEFAULT_GC_INTERNAL_MODE = "stale" satisfies InternalGcMode;
const DEFAULT_GC_INTERNAL_TTL_MIN = 15;
const DEFAULT_GC_MAX_DELETES = 25;
const DEFAULT_GC_DELETE_TIMEOUT_MS = 5_000;
const DEFAULT_GC_BUDGET_MS = 30_000;
const LOOPBACK_HOST = "127.0.0.1";

type CompletionVisibleFallbackMode = "auto" | "on" | "off";
type BeadsMode = "on" | "off" | "inherit";
type CodexCleanSlateMode = "on" | "off";
type DynamicContextMode = "on" | "off";
type GarbageCollectMode = "on" | "off";
type InternalGcMode = "stale" | "all";

export interface DynamicContextSettingsPatch {
	dynamicContext: boolean;
}

export interface PaiTuiSettingsPatch {
	dynamicContext?: boolean;
	paiFeatures?: {
		beads?: boolean;
	};
}

export interface PaiTuiRunOptions {
	dir: string;
	startPort: number;
	opencodeRoot: string;
	completionVisibleFallback: CompletionVisibleFallbackMode;
	codexCleanSlate?: CodexCleanSlateMode;
	dynamicContext: DynamicContextMode;
	beads?: BeadsMode;
	gc: GarbageCollectMode;
	gcOnStart: GarbageCollectMode;
	gcOnExit: GarbageCollectMode;
	gcInternalMode: InternalGcMode;
	gcInternalTtlMin: number;
	gcMaxDeletes: number;
	gcDeleteTimeoutMs: number;
	gcBudgetMs: number;
	bindRetries: number;
	writeState: boolean;
	passthroughArgs: string[];
}

export interface RunOpencodeCliInput {
	binary: string;
	args: string[];
	env: Record<string, string>;
	cwd: string;
	timeoutMs: number;
	stdoutPrefix?: string;
	stderrPrefix?: string;
	stream?: boolean;
}

export interface RunOpencodeCliResult {
	exitCode: number;
	stdout: string;
	stderr: string;
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
	runOpencodeCli: (input: RunOpencodeCliInput) => Promise<RunOpencodeCliResult>;
	writeSettingsPatch: (
		opencodeRoot: string,
		patch: PaiTuiSettingsPatch,
	) => Promise<void>;
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
	codexCleanSlate?: CodexCleanSlateMode;
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
	"  pai-tui [wrapper options] [opencode args...]",
	"",
	"Wrapper options:",
	"  --dir <path>                                   Working directory for child OpenCode process",
	"  --port <n>                                     Starting port to probe for free bind",
	"  --opencode-root <path>                         OpenCode config/runtime root",
	"  --completion-visible-fallback <auto|on|off>    Fallback env behavior when cmux socket is missing",
	"  --beads <on|off|inherit>                        Persist settings.json.paiFeatures.beads (default: inherit)",
	"  --codex-clean-slate <on|off>                    Explicitly set PAI_CODEX_CLEAN_SLATE (omit flag to inherit)",
	"  --dynamic-context <on|off>                      Persist settings.json.dynamicContext for SessionStart injection",
	"  --gc <on|off>                                   Garbage-collect leaked sessions (default: on)",
	"  --gc-on-start <on|off>                           Run GC before starting the TUI (default: on)",
	"  --gc-on-exit <on|off>                            Run GC after the TUI exits (default: on)",
	"  --gc-internal-mode <stale|all>                   GC mode for [PAI INTERNAL] sessions (default: stale)",
	"  --gc-internal-ttl-min <n>                        Stale threshold minutes (default: 15)",
	"  --gc-max-deletes <n>                             Max deletes per GC pass (default: 25)",
	"  --gc-delete-timeout-ms <n>                       Per-delete timeout (default: 5000)",
	"  --gc-budget-ms <n>                               Total GC time budget (default: 30000)",
	"  --bind-retries <n>                             Retries for rapid bind-race exits",
	"  --write-state <on|off>                         Persist pai-tui state artifacts",
	"",
	"Defaults:",
	`  --dir ${process.cwd()}`,
	`  --port ${DEFAULT_START_PORT}`,
	`  --opencode-root ${resolveRuntimeRootFromMainScript(import.meta.url)}`,
	"  --completion-visible-fallback auto",
	"  --beads inherit",
	"  --codex-clean-slate omitted (inherit parent env; unchanged)",
	"  --dynamic-context on",
	`  --gc ${DEFAULT_GC}`,
	`  --gc-on-start ${DEFAULT_GC_ON_START}`,
	`  --gc-on-exit ${DEFAULT_GC_ON_EXIT}`,
	`  --gc-internal-mode ${DEFAULT_GC_INTERNAL_MODE}`,
	`  --gc-internal-ttl-min ${DEFAULT_GC_INTERNAL_TTL_MIN}`,
	`  --gc-max-deletes ${DEFAULT_GC_MAX_DELETES}`,
	`  --gc-delete-timeout-ms ${DEFAULT_GC_DELETE_TIMEOUT_MS}`,
	`  --gc-budget-ms ${DEFAULT_GC_BUDGET_MS}`,
	`  --bind-retries ${DEFAULT_BIND_RETRIES}`,
	"  --write-state on",
	"",
	"Pass extra OpenCode args after wrapper options.",
	"Example: pai-tui --dir /repo -s ses_abc123",
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

function extractExcludedSessionIds(passthroughArgs: string[]): Set<string> {
	const out = new Set<string>();
	for (let idx = 0; idx < passthroughArgs.length; idx += 1) {
		const token = passthroughArgs[idx];
		if (token === "-s" || token === "--session") {
			const value = passthroughArgs[idx + 1];
			if (isLikelyValueToken(value)) {
				out.add(String(value));
				idx += 1;
			}
			continue;
		}
		if (token.startsWith("--session=")) {
			const value = token.slice("--session=".length).trim();
			if (value) out.add(value);
		}
	}
	return out;
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
	const cmuxSocketPath = (env.CMUX_SOCKET_PATH ?? "").trim();

	env.OPENCODE_SERVER_URL = serverUrl;
	env.OPENCODE_CONFIG_DIR = input.opencodeRoot;
	env.OPENCODE_ROOT = input.opencodeRoot;
	env.OPENCODE_CONFIG_ROOT = input.opencodeRoot;
	env.PAI_DIR = input.opencodeRoot;

	// In cmux environments, capture cmux failures to MEMORY/STATE/cmux-last-error.json.
	if (!String(env.PAI_CMUX_DEBUG ?? "").trim() && cmuxSocketPath) {
		env.PAI_CMUX_DEBUG = "1";
	}

	if (input.completionVisibleFallback === "on") {
		env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK = "1";
	} else if (input.completionVisibleFallback === "off") {
		delete env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK;
	} else {
		if (!cmuxSocketPath) {
			env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK = "1";
		}
	}

	if (input.codexCleanSlate === "on") {
		env.PAI_CODEX_CLEAN_SLATE = "1";
	} else if (input.codexCleanSlate === "off") {
		env.PAI_CODEX_CLEAN_SLATE = "0";
	}

	return env;
}

export function resolveDynamicContextMode(
	value: DynamicContextMode | undefined,
): DynamicContextMode {
	return value ?? "on";
}

export function buildDynamicContextSettingsPatch(
	mode: DynamicContextMode,
): DynamicContextSettingsPatch {
	return {
		dynamicContext: mode === "on",
	};
}

export function resolveBeadsMode(value: BeadsMode | undefined): BeadsMode {
	return value ?? "inherit";
}

function buildSettingsPatch(
	dynamicContextMode: DynamicContextMode,
	beadsMode: BeadsMode,
): PaiTuiSettingsPatch {
	const patch: PaiTuiSettingsPatch = {
		...buildDynamicContextSettingsPatch(dynamicContextMode),
	};

	if (beadsMode === "on") {
		patch.paiFeatures = { beads: true };
	} else if (beadsMode === "off") {
		patch.paiFeatures = { beads: false };
	}

	return patch;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMergeRecords(
	existing: Record<string, unknown>,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const next: Record<string, unknown> = { ...existing };

	for (const [key, patchValue] of Object.entries(patch)) {
		const existingValue = next[key];
		if (isPlainRecord(existingValue) && isPlainRecord(patchValue)) {
			next[key] = deepMergeRecords(existingValue, patchValue);
			continue;
		}
		next[key] = patchValue;
	}

	return next;
}

export async function writeSettingsPatch(
	opencodeRoot: string,
	patch: PaiTuiSettingsPatch,
): Promise<void> {
	const settingsPath = path.join(opencodeRoot, "settings.json");
	let existing: Record<string, unknown> | null = null;
	let raw = "";
	let hasExistingFile = false;

	try {
		raw = await fs.readFile(settingsPath, "utf8");
		hasExistingFile = true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			throw new Error(
				`Unable to read existing settings.json at ${settingsPath}: ${code ?? String(error)}`,
			);
		}
	}

	if (hasExistingFile) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Invalid JSON in existing settings.json at ${settingsPath}: ${message}`,
			);
		}

		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new Error(
				`Invalid JSON in existing settings.json at ${settingsPath}: expected top-level object`,
			);
		}

		existing = parsed as Record<string, unknown>;
	}

	const next = deepMergeRecords(
		existing ?? {},
		patch as Record<string, unknown>,
	);
	await atomicWriteJson(settingsPath, next);
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

function flushPrefixedLines(args: {
	buffer: string;
	prefix: string;
	write: (text: string) => void;
}): string {
	let buf = args.buffer;
	while (true) {
		const idx = buf.indexOf("\n");
		if (idx === -1) return buf;
		const line = buf.slice(0, idx + 1);
		buf = buf.slice(idx + 1);
		args.write(args.prefix ? `${args.prefix}${line}` : line);
	}
}

async function defaultRunOpencodeCli(
	input: RunOpencodeCliInput,
): Promise<RunOpencodeCliResult> {
	return await new Promise((resolve, reject) => {
		const child = spawn(input.binary, input.args, {
			cwd: input.cwd,
			env: input.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let stdoutBuf = "";
		let stderrBuf = "";
		const stream = Boolean(input.stream);
		const stdoutPrefix = input.stdoutPrefix ?? "";
		const stderrPrefix = input.stderrPrefix ?? "";

		const timer = setTimeout(() => {
			child.kill("SIGKILL");
		}, input.timeoutMs);

		child.stdout?.on("data", (chunk) => {
			const text = chunk.toString();
			stdout += text;
			if (!stream) return;
			stdoutBuf += text;
			stdoutBuf = flushPrefixedLines({
				buffer: stdoutBuf,
				prefix: stdoutPrefix,
				write: (line) => process.stdout.write(line),
			});
		});

		child.stderr?.on("data", (chunk) => {
			const text = chunk.toString();
			stderr += text;
			if (!stream) return;
			stderrBuf += text;
			stderrBuf = flushPrefixedLines({
				buffer: stderrBuf,
				prefix: stderrPrefix,
				write: (line) => process.stderr.write(line),
			});
		});

		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});

		child.once("close", (code) => {
			clearTimeout(timer);
			if (stream) {
				if (stdoutBuf) {
					process.stdout.write(
						stdoutPrefix ? `${stdoutPrefix}${stdoutBuf}` : stdoutBuf,
					);
					stdoutBuf = "";
				}
				if (stderrBuf) {
					process.stderr.write(
						stderrPrefix ? `${stderrPrefix}${stderrBuf}` : stderrBuf,
					);
					stderrBuf = "";
				}
			}
			resolve({
				exitCode: normalizeExitCode(code ?? 1),
				stdout,
				stderr,
			});
		});
	});
}

function defaultDeps(): PaiTuiDeps {
	return {
		resolveBinary: async () => await resolveServeCapableOpencodeBinary(),
		selectFreePort: findFirstAvailablePort,
		spawnChild: defaultSpawnChild,
		isPortAvailable,
		runOpencodeCli: defaultRunOpencodeCli,
		writeSettingsPatch,
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

type SessionListItem = {
	id: string;
	title: string;
	created: number;
	updated: number;
	projectId?: string;
	directory?: string;
};

type GcLockV1 = {
	v: 1;
	pid: number;
	createdAt: string;
};

function buildOpencodeCliEnv(args: {
	baseEnv: NodeJS.ProcessEnv;
	opencodeRoot: string;
}): Record<string, string> {
	const env = envToRecord(args.baseEnv);
	env.OPENCODE_CONFIG_DIR = args.opencodeRoot;
	env.OPENCODE_ROOT = args.opencodeRoot;
	env.OPENCODE_CONFIG_ROOT = args.opencodeRoot;
	env.PAI_DIR = args.opencodeRoot;
	return env;
}

function isInternalSessionTitle(title: string): boolean {
	return title.trimStart().startsWith("[PAI INTERNAL]");
}

function safeNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function parseSessionListJson(raw: string): SessionListItem[] {
	const parsed = JSON.parse(raw) as unknown;
	if (!Array.isArray(parsed)) return [];

	const out: SessionListItem[] = [];
	for (const item of parsed) {
		if (typeof item !== "object" || item === null) continue;
		const rec = item as Record<string, unknown>;
		const id = safeString(rec.id);
		const title = safeString(rec.title);
		const created = safeNumber(rec.created);
		const updated = safeNumber(rec.updated);
		if (!id || !title || created === null || updated === null) continue;
		out.push({
			id,
			title,
			created,
			updated,
			projectId: safeString(rec.projectId) ?? undefined,
			directory: safeString(rec.directory) ?? undefined,
		});
	}
	return out;
}

function formatAgeMinutes(nowMs: number, updatedMs: number): string {
	const ageMs = Math.max(0, nowMs - updatedMs);
	const minutes = Math.floor(ageMs / 60000);
	return `${minutes}m`;
}

async function acquireGcLock(args: {
	stateDir: string;
	nowMs: number;
	staleAfterMs: number;
}): Promise<{ acquired: boolean; lockPath: string }> {
	await fs.mkdir(args.stateDir, { recursive: true });
	const lockPath = path.join(args.stateDir, "pai-tui-gc.lock");
	const existing = await readJsonIfExists(lockPath);

	if (existing) {
		const pid = typeof existing.pid === "number" ? existing.pid : null;
		const createdAt =
			typeof existing.createdAt === "string" ? existing.createdAt : null;
		const createdAtMs = createdAt ? Date.parse(createdAt) : Number.NaN;
		const ageMs = Number.isFinite(createdAtMs)
			? args.nowMs - createdAtMs
			: Number.POSITIVE_INFINITY;

		if (pid && isProcessAlive(pid) && ageMs < args.staleAfterMs) {
			return { acquired: false, lockPath };
		}
	}

	const lock: GcLockV1 = {
		v: 1,
		pid: process.pid,
		createdAt: new Date(args.nowMs).toISOString(),
	};
	await atomicWriteJson(lockPath, lock);
	return { acquired: true, lockPath };
}

async function releaseGcLock(lockPath: string): Promise<void> {
	try {
		await fs.rm(lockPath, { force: true });
	} catch {
		// best-effort
	}
}

async function runGcPass(args: {
	phase: "start" | "exit";
	options: PaiTuiRunOptions;
	deps: PaiTuiDeps;
	binary: string;
	excludeSessionIds: Set<string>;
}): Promise<void> {
	const enabled = args.options.gc !== "off";
	const phaseEnabled =
		args.phase === "start"
			? args.options.gcOnStart !== "off"
			: args.options.gcOnExit !== "off";
	if (!enabled || !phaseEnabled) return;

	const startMs = args.deps.nowMs();
	const stateDir = path.join(args.options.opencodeRoot, "MEMORY", "STATE");
	const lockStaleAfterMs = Math.max(2 * 60 * 1000, args.options.gcBudgetMs * 2);
	const lock = await acquireGcLock({
		stateDir,
		nowMs: startMs,
		staleAfterMs: lockStaleAfterMs,
	});
	if (!lock.acquired) return;

	let deleted = 0;
	let skipped = 0;
	let errors = 0;
	const budgetDeadline = startMs + Math.max(0, args.options.gcBudgetMs);

	const env = buildOpencodeCliEnv({
		baseEnv: process.env,
		opencodeRoot: args.options.opencodeRoot,
	});

	const withinBudget = () => args.deps.nowMs() < budgetDeadline;
	const canDeleteMore = () => deleted < Math.max(0, args.options.gcMaxDeletes);

	args.deps.logInfo(
		`GC starting… (mode=${args.options.gcInternalMode} ttl=${args.options.gcInternalTtlMin}m cap=${args.options.gcMaxDeletes})`,
	);

	try {
		// 1) Process /wq markers first.
		const entries = await fs.readdir(stateDir).catch(() => []);
		const markers = entries
			.filter(
				(name) =>
					name.startsWith("pai-wq-exit-intent.") && name.endsWith(".json"),
			)
			.map((name) => path.join(stateDir, name));

		for (const markerPath of markers) {
			if (!withinBudget() || !canDeleteMore()) break;
			const markerRaw = await readJsonIfExists(markerPath);
			if (!markerRaw) {
				continue;
			}
			const pid = typeof markerRaw.pid === "number" ? markerRaw.pid : null;
			const sessionId =
				typeof markerRaw.sessionId === "string" ? markerRaw.sessionId : "";
			if (!sessionId) {
				await fs.rm(markerPath, { force: true }).catch(() => {});
				continue;
			}
			if (pid && isProcessAlive(pid)) {
				skipped += 1;
				continue;
			}
			if (args.excludeSessionIds.has(sessionId)) {
				skipped += 1;
				await fs.rm(markerPath, { force: true }).catch(() => {});
				continue;
			}

			try {
				const res = await args.deps.runOpencodeCli({
					binary: args.binary,
					args: ["session", "delete", sessionId],
					env,
					cwd: args.options.dir,
					timeoutMs: args.options.gcDeleteTimeoutMs,
					stream: false,
				});

				if (res.exitCode === 0) {
					deleted += 1;
					await fs.rm(markerPath, { force: true }).catch(() => {});
					args.deps.logInfo(`[PAI GC] deleted ${sessionId} (from /wq marker)`);
					continue;
				}

				const combined = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim();
				if (/Session not found/i.test(combined)) {
					// Already gone; remove marker quietly.
					skipped += 1;
					await fs.rm(markerPath, { force: true }).catch(() => {});
					continue;
				}

				errors += 1;
				const firstLine = combined.split(/\r?\n/).find(Boolean) ?? "";
				const preview =
					firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
				args.deps.logWarn(
					`[PAI GC] failed to delete ${sessionId} (from /wq marker)${preview ? `: ${preview}` : ""}`,
				);
			} catch {
				errors += 1;
			}
		}

		// 2) Prune internal sessions.
		if (withinBudget() && canDeleteMore()) {
			const listRes = await args.deps.runOpencodeCli({
				binary: args.binary,
				args: ["session", "list", "--format", "json"],
				env,
				cwd: args.options.dir,
				timeoutMs: Math.min(args.options.gcBudgetMs, 5000),
				stream: false,
			});

			let sessions: SessionListItem[] = [];
			try {
				sessions = parseSessionListJson(listRes.stdout);
			} catch {
				sessions = [];
			}

			const nowMs = args.deps.nowMs();
			const ttlMs = Math.max(0, args.options.gcInternalTtlMin) * 60_000;
			const candidates = sessions
				.filter((s) => !args.excludeSessionIds.has(s.id))
				.filter((s) => isInternalSessionTitle(s.title))
				.filter((s) => {
					if (args.options.gcInternalMode === "all") return true;
					return nowMs - s.updated >= ttlMs;
				})
				.sort((a, b) => a.updated - b.updated);

			for (const session of candidates) {
				if (!withinBudget() || !canDeleteMore()) break;
				const age = formatAgeMinutes(args.deps.nowMs(), session.updated);
				args.deps.logInfo(
					`[PAI GC] deleting ${session.id} (${session.title}, age ${age})`,
				);
				try {
					const res = await args.deps.runOpencodeCli({
						binary: args.binary,
						args: ["session", "delete", session.id],
						env,
						cwd: args.options.dir,
						timeoutMs: args.options.gcDeleteTimeoutMs,
						stdoutPrefix: "[opencode] ",
						stderrPrefix: "[opencode] ",
						stream: true,
					});
					if (res.exitCode === 0) {
						deleted += 1;
					} else {
						errors += 1;
					}
				} catch {
					errors += 1;
				}
			}
		}
	} finally {
		await releaseGcLock(lock.lockPath);
		const elapsed = args.deps.nowMs() - startMs;
		args.deps.logInfo(
			`GC done: deleted ${deleted} in ${elapsed}ms; skipped ${skipped}; errors ${errors}`,
		);
	}
}

export async function runPaiTui(
	options: PaiTuiRunOptions,
	overrides: Partial<PaiTuiDeps> = {},
): Promise<number> {
	const deps = { ...defaultDeps(), ...overrides };
	const settingsPatch = buildSettingsPatch(
		resolveDynamicContextMode(options.dynamicContext),
		resolveBeadsMode(options.beads),
	);

	try {
		await deps.writeSettingsPatch(options.opencodeRoot, settingsPatch);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		deps.logWarn(`Failed to persist settings patch: ${message}`);
		return 1;
	}

	const binary = await deps.resolveBinary();
	const sanitized = sanitizePassthroughArgs(options.passthroughArgs);
	if (sanitized.removed.length > 0) {
		deps.logWarn(
			`Stripped conflicting passthrough args: ${[...new Set(sanitized.removed)].join(", ")}`,
		);
	}

	let nextPortStart = normalizeInteger(options.startPort, "startPort");
	const bindRetries = Math.max(0, Math.trunc(options.bindRetries));
	const excludeSessionIds = extractExcludedSessionIds(sanitized.args);

	try {
		await runGcPass({
			phase: "start",
			options,
			deps,
			binary,
			excludeSessionIds,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		deps.logWarn(`GC failed (start): ${message}`);
	}

	let finalExitCode = 1;

	try {
		for (let attempt = 0; attempt <= bindRetries; attempt += 1) {
			const port = await deps.selectFreePort(nextPortStart);
			const serverUrl = `http://${LOOPBACK_HOST}:${port}`;
			const env = buildChildEnv({
				baseEnv: process.env,
				opencodeRoot: options.opencodeRoot,
				port,
				completionVisibleFallback: options.completionVisibleFallback,
				codexCleanSlate: options.codexCleanSlate,
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

			if (
				options.writeState &&
				typeof child.pid === "number" &&
				child.pid > 0
			) {
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
					finalExitCode = normalizeExitCode(finalExit);
					break;
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					deps.logWarn(`OpenCode process crashed: ${message}`);
					finalExitCode = 1;
					break;
				}
			}

			if (early.exitCode === 0) {
				finalExitCode = 0;
				break;
			}

			const retriesRemain = attempt < bindRetries;
			const stillOccupied = !(await deps.isPortAvailable(port));
			const likelyBindRace =
				early.elapsedMs <= deps.quickExitMs && stillOccupied;

			if (retriesRemain && likelyBindRace) {
				nextPortStart = port + 1;
				deps.logWarn(
					`Rapid bind failure on port ${port}; retrying with next free port.`,
				);
				continue;
			}

			finalExitCode = early.exitCode;
			break;
		}
	} finally {
		try {
			await runGcPass({
				phase: "exit",
				options,
				deps,
				binary,
				excludeSessionIds,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.logWarn(`GC failed (exit): ${message}`);
		}
	}

	return finalExitCode;
}

function createCliCommand() {
	return command({
		name: "pai-tui",
		args: {
			dir: option({ long: "dir", type: optional(string) }),
			port: option({ long: "port", type: optional(string) }),
			opencodeRoot: option({ long: "opencode-root", type: optional(string) }),
			dynamicContext: option({
				long: "dynamic-context",
				type: optional(oneOf(["on", "off"])),
			}),
			completionVisibleFallback: option({
				long: "completion-visible-fallback",
				type: optional(oneOf(["auto", "on", "off"])),
			}),
			beads: option({
				long: "beads",
				type: optional(oneOf(["on", "off", "inherit"])),
			}),
			codexCleanSlate: option({
				long: "codex-clean-slate",
				type: optional(oneOf(["on", "off"])),
			}),
			gc: option({
				long: "gc",
				type: optional(oneOf(["on", "off"])),
			}),
			gcOnStart: option({
				long: "gc-on-start",
				type: optional(oneOf(["on", "off"])),
			}),
			gcOnExit: option({
				long: "gc-on-exit",
				type: optional(oneOf(["on", "off"])),
			}),
			gcInternalMode: option({
				long: "gc-internal-mode",
				type: optional(oneOf(["stale", "all"])),
			}),
			gcInternalTtlMin: option({
				long: "gc-internal-ttl-min",
				type: optional(string),
			}),
			gcMaxDeletes: option({
				long: "gc-max-deletes",
				type: optional(string),
			}),
			gcDeleteTimeoutMs: option({
				long: "gc-delete-timeout-ms",
				type: optional(string),
			}),
			gcBudgetMs: option({
				long: "gc-budget-ms",
				type: optional(string),
			}),
			bindRetries: option({ long: "bind-retries", type: optional(string) }),
			writeState: option({
				long: "write-state",
				type: optional(oneOf(["on", "off"])),
			}),
			opencodeArgs: rest({
				displayName: "opencode-args",
				description: "arguments passed to opencode",
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

			const parsedGcInternalTtlMin = normalizeInteger(
				Number.parseInt(
					args.gcInternalTtlMin ?? String(DEFAULT_GC_INTERNAL_TTL_MIN),
					10,
				),
				"--gc-internal-ttl-min",
				0,
			);
			const parsedGcMaxDeletes = normalizeInteger(
				Number.parseInt(
					args.gcMaxDeletes ?? String(DEFAULT_GC_MAX_DELETES),
					10,
				),
				"--gc-max-deletes",
				0,
			);
			const parsedGcDeleteTimeoutMs = normalizeInteger(
				Number.parseInt(
					args.gcDeleteTimeoutMs ?? String(DEFAULT_GC_DELETE_TIMEOUT_MS),
					10,
				),
				"--gc-delete-timeout-ms",
				0,
			);
			const parsedGcBudgetMs = normalizeInteger(
				Number.parseInt(args.gcBudgetMs ?? String(DEFAULT_GC_BUDGET_MS), 10),
				"--gc-budget-ms",
				0,
			);

			const exitCode = await runPaiTui({
				dir: path.resolve(args.dir ?? process.cwd()),
				startPort: parsedPort,
				opencodeRoot: path.resolve(
					args.opencodeRoot ??
						resolveRuntimeRootFromMainScript(import.meta.url),
				),
				dynamicContext: resolveDynamicContextMode(
					args.dynamicContext as DynamicContextMode | undefined,
				),
				beads: resolveBeadsMode(args.beads as BeadsMode | undefined),
				completionVisibleFallback: (args.completionVisibleFallback ??
					"auto") as CompletionVisibleFallbackMode,
				codexCleanSlate: args.codexCleanSlate as
					| CodexCleanSlateMode
					| undefined,
				gc: (args.gc ?? DEFAULT_GC) as GarbageCollectMode,
				gcOnStart: (args.gcOnStart ??
					DEFAULT_GC_ON_START) as GarbageCollectMode,
				gcOnExit: (args.gcOnExit ?? DEFAULT_GC_ON_EXIT) as GarbageCollectMode,
				gcInternalMode: (args.gcInternalMode ??
					DEFAULT_GC_INTERNAL_MODE) as InternalGcMode,
				gcInternalTtlMin: parsedGcInternalTtlMin,
				gcMaxDeletes: parsedGcMaxDeletes,
				gcDeleteTimeoutMs: parsedGcDeleteTimeoutMs,
				gcBudgetMs: parsedGcBudgetMs,
				bindRetries: parsedBindRetries,
				writeState: (args.writeState ?? "on") === "on",
				passthroughArgs: args.opencodeArgs,
			});

			if (exitCode !== 0) {
				process.exit(exitCode);
			}
		},
	});
}

if (import.meta.main) {
	const argv = process.argv.slice(2);

	if (helpRequested(argv)) {
		console.log(HELP_TEXT);
		process.exit(0);
	}

	try {
		assertOptionValueProvided(argv, "--bind-retries");
		assertOptionValueProvided(argv, "--beads");
		assertOptionValueProvided(argv, "--codex-clean-slate");
		assertOptionValueProvided(argv, "--dynamic-context");
		assertOptionValueProvided(argv, "--gc");
		assertOptionValueProvided(argv, "--gc-on-start");
		assertOptionValueProvided(argv, "--gc-on-exit");
		assertOptionValueProvided(argv, "--gc-internal-mode");
		assertOptionValueProvided(argv, "--gc-internal-ttl-min");
		assertOptionValueProvided(argv, "--gc-max-deletes");
		assertOptionValueProvided(argv, "--gc-delete-timeout-ms");
		assertOptionValueProvided(argv, "--gc-budget-ms");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`ERROR: ${message}`);
		process.exit(1);
	}

	const app = createCliCommand();
	runSafely(app, argv)
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
