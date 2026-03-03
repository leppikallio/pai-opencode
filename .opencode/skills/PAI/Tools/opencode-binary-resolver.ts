import { spawn } from "node:child_process";

const REQUIRED_SERVE_FLAGS = ["--port", "--hostname"] as const;

export interface ResolveServeCapableOpencodeBinaryOptions {
	env?: NodeJS.ProcessEnv;
	preferredBinary?: string;
	timeoutMs?: number;
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		if (!value) continue;
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

async function readHelpText(
	binary: string,
	timeoutMs: number,
	env: NodeJS.ProcessEnv,
): Promise<string | null> {
	return await new Promise((resolve) => {
		const child = spawn(binary, ["--help"], {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let settled = false;

		const finish = (value: string | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve(value);
		};

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");

		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});

		child.once("error", () => {
			finish(null);
		});

		child.once("exit", () => {
			finish(`${stdout}\n${stderr}`.trim());
		});

		const timeout = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// Best effort timeout kill.
			}
			finish(null);
		}, timeoutMs);
	});
}

function isServeCapableHelpText(helpText: string | null): boolean {
	if (!helpText) return false;
	return REQUIRED_SERVE_FLAGS.every((flag) => helpText.includes(flag));
}

export async function resolveServeCapableOpencodeBinary(
	options: ResolveServeCapableOpencodeBinaryOptions = {},
): Promise<string> {
	const env = options.env ?? process.env;
	const timeoutMs =
		Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
			? Number(options.timeoutMs)
			: 1200;

	const candidates = uniqueNonEmpty([
		options.preferredBinary,
		env.PAI_OPENCODE_BIN,
		env.OPENCODE_BIN,
		Bun.which("opencode") ?? undefined,
		"opencode",
	]);

	for (const candidate of candidates) {
		const help = await readHelpText(candidate, timeoutMs, env);
		if (isServeCapableHelpText(help)) {
			return candidate;
		}
	}

	throw new Error(
		"Unable to resolve a serve-capable opencode binary (missing --port/--hostname support).",
	);
}
