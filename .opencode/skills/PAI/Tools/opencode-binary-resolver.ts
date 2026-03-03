import * as path from "node:path";

import { withScopedProcessEnv } from "./opencode-scoped-env";

export function buildPathWithBinaryFirst(
	pathEnv: string | undefined,
	binaryPath: string,
	platform: NodeJS.Platform = process.platform,
): string {
	const delimiter = platform === "win32" ? ";" : ":";
	const binaryDir = path.dirname(binaryPath);
	const existing = (pathEnv ?? "").split(delimiter).filter(Boolean);
	const withoutBinaryDir = existing.filter((p) => p !== binaryDir);
	return [binaryDir, ...withoutBinaryDir].join(delimiter);
}

export function collectCandidateBinaryPaths(
	_pathEnv: string | undefined,
	whichFn: (cmd: string) => string | null = Bun.which,
	platform: NodeJS.Platform = process.platform,
): string[] {
	const out: string[] = [];
	const which = whichFn("opencode");
	if (which) out.push(which);

	// Common locations (best-effort; probe decides final correctness).
	if (platform === "darwin") {
		out.push("/opt/homebrew/bin/opencode");
		out.push("/usr/local/bin/opencode");
		out.push("/usr/bin/opencode");
	} else if (platform === "linux") {
		out.push("/usr/local/bin/opencode");
		out.push("/usr/bin/opencode");
		out.push("/bin/opencode");
	}

	// De-dupe preserving order.
	return [...new Set(out)];
}

export interface ResolveServeCapableOpencodeBinaryOptions {
	env?: NodeJS.ProcessEnv;
	preferredBinary?: string;
	pathEnv?: string;
	probeFn?: (binaryPath: string) => Promise<boolean>;
	whichFn?: (cmd: string) => string | null;
	platform?: NodeJS.Platform;
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
	const out: string[] = [];
	for (const value of values) {
		if (!value) continue;
		const trimmed = value.trim();
		if (!trimmed) continue;
		if (out.includes(trimmed)) continue;
		out.push(trimmed);
	}
	return out;
}

async function runBinary(
	binaryPath: string,
	args: string[],
	timeoutMs = 1500,
): Promise<boolean> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const proc = Bun.spawn([binaryPath, ...args], {
			stdout: "ignore",
			stderr: "ignore",
			stdin: "ignore",
			signal: controller.signal,
		});

		const code = await proc.exited;
		return code === 0;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

export async function canExecuteBinary(binaryPath: string): Promise<boolean> {
	return runBinary(binaryPath, ["--version"]);
}

export async function canServe(binaryPath: string): Promise<boolean> {
	return runBinary(binaryPath, ["serve", "--help"]);
}

export async function isServeCapableOpencode(
	binaryPath: string,
): Promise<boolean> {
	if (!(await canExecuteBinary(binaryPath))) return false;
	return canServe(binaryPath);
}

export async function resolveServeCapableOpencodeBinary(
	options: ResolveServeCapableOpencodeBinaryOptions = {},
): Promise<string> {
	const env = options.env ?? process.env;
	const pathEnv = options.pathEnv ?? env.PATH;
	const probeFn = options.probeFn ?? isServeCapableOpencode;
	const whichFn = options.whichFn ?? Bun.which;
	const platform = options.platform ?? process.platform;

	const candidates = uniqueNonEmpty([
		options.preferredBinary,
		env.PAI_OPENCODE_BIN,
		env.OPENCODE_BIN,
		...collectCandidateBinaryPaths(pathEnv, whichFn, platform),
		"opencode",
	]);

	for (const candidate of candidates) {
		if (await probeFn(candidate)) return candidate;
	}

	throw new Error("No serve-capable 'opencode' binary found");
}

export async function findWorkingOpencodeBinary(
	pathEnv: string | undefined,
	probeFn: (binaryPath: string) => Promise<boolean> = isServeCapableOpencode,
	whichFn: (cmd: string) => string | null = Bun.which,
	platform: NodeJS.Platform = process.platform,
	collectFn: (
		pathEnv: string | undefined,
		whichFn: (cmd: string) => string | null,
		platform: NodeJS.Platform,
	) => string[] = collectCandidateBinaryPaths,
): Promise<string | null> {
	const candidates = collectFn(pathEnv, whichFn, platform);
	for (const candidate of candidates) {
		if (await probeFn(candidate)) return candidate;
	}
	return null;
}

export async function withWorkingOpencodePath<T>(
	fn: () => Promise<T>,
	opts?: {
		pathEnv?: string;
		findBinary?: (pathEnv: string | undefined) => Promise<string | null>;
	},
): Promise<T> {
	const pathEnv = opts?.pathEnv ?? process.env.PATH;
	const findBinary =
		opts?.findBinary ?? ((env) => findWorkingOpencodeBinary(env));
	const binaryPath = await findBinary(pathEnv);

	if (!binaryPath) {
		throw new Error("No serve-capable 'opencode' binary found in PATH");
	}

	const nextPath = buildPathWithBinaryFirst(pathEnv, binaryPath);
	return withScopedProcessEnv({ PATH: nextPath }, fn);
}
