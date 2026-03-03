import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";

type CliRunResult = {
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
};

type CliRunOptions = {
	extraEnv?: Record<string, string | undefined>;
	signalAfterMs?: number;
	signal?: NodeJS.Signals;
};

const inferenceCliPath = fileURLToPath(
	new URL("../../skills/PAI/Tools/Inference.ts", import.meta.url),
);

const testsRoot = fileURLToPath(new URL("../..", import.meta.url));

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJson(
	res: ServerResponse,
	status: number,
	payload: unknown,
): Promise<void> {
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(payload));
}

function runInferenceCli(
	args: string[],
	options: CliRunOptions = {},
): Promise<CliRunResult> {
	const { extraEnv = {}, signalAfterMs, signal = "SIGTERM" } = options;

	return new Promise((resolve, reject) => {
		const child = spawn("bun", [inferenceCliPath, ...args], {
			cwd: testsRoot,
			shell: false,
			env: {
				...process.env,
				OPENCODE_SERVER_URL: undefined,
				OPENCODE_SERVER_PASSWORD: undefined,
				OPENCODE_SERVER_USERNAME: undefined,
				...extraEnv,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`Inference CLI timed out: ${args.join(" ")}`));
		}, 15000);

		const signalTimer =
			signalAfterMs !== undefined
				? setTimeout(() => {
						child.kill(signal);
					}, signalAfterMs)
				: null;

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});

		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		child.on("error", (error) => {
			clearTimeout(timer);
			if (signalTimer) clearTimeout(signalTimer);
			reject(error);
		});

		child.on("close", (code, signal) => {
			clearTimeout(timer);
			if (signalTimer) clearTimeout(signalTimer);
			resolve({ code, signal, stdout, stderr });
		});
	});
}

function parseSingleJsonObject(stdout: string): Record<string, unknown> {
	const parsed = JSON.parse(stdout) as unknown;
	expect(parsed).not.toBeNull();
	expect(Array.isArray(parsed)).toBe(false);
	expect(typeof parsed).toBe("object");
	expect(stdout.trim()).toBe(JSON.stringify(parsed));
	return parsed as Record<string, unknown>;
}

describe("PAI Inference CLI contract", () => {
	let baseUrl = "";
	let server: ReturnType<typeof createServer> | null = null;

	beforeAll(async () => {
		server = createServer(async (req, res) => {
			const path = req.url || "/";
			const method = req.method || "";

			if (method === "GET" && path === "/global/health") {
				await writeJson(res, 200, { healthy: true, version: "test" });
				return;
			}

			if (method === "POST" && path === "/session") {
				await readBody(req);
				await writeJson(res, 200, { id: "S1" });
				return;
			}

			if (method === "POST" && path === "/session/S1/message") {
				const body = await readBody(req);
				const payload = JSON.parse(body) as {
					parts?: Array<{ type?: string; text?: string }>;
				};
				const userPrompt =
					payload.parts?.find((part) => part.type === "text")?.text ?? "";

				if (userPrompt.includes("force runtime failure")) {
					await writeJson(res, 500, { error: "forced runtime failure" });
					return;
				}

				if (userPrompt.includes("force delayed response")) {
					await wait(3000);
				}

				if (userPrompt.startsWith("--")) {
					await writeJson(res, 200, {
						info: { id: "M1", sessionID: "S1", role: "assistant" },
						parts: [{ type: "text", text: '{"ok":"dash"}' }],
					});
					return;
				}

				await writeJson(res, 200, {
					info: { id: "M1", sessionID: "S1", role: "assistant" },
					parts: [{ type: "text", text: '{"ok":true}' }],
				});
				return;
			}

			if (method === "DELETE" && path === "/session/S1") {
				await readBody(req);
				await writeJson(res, 200, true);
				return;
			}

			await readBody(req);
			await writeJson(res, 404, { error: "not found" });
		});

		if (!server) {
			throw new Error("failed to create fake OpenCode server");
		}
		const runningServer = server;

		await new Promise<void>((resolve) => {
			runningServer.listen(0, "127.0.0.1", () => resolve());
		});

		const address = runningServer.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to start fake OpenCode server");
		}

		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	afterAll(async () => {
		if (!server) return;
		const runningServer = server;
		await new Promise<void>((resolve) => runningServer.close(() => resolve()));
	});

	test("--help includes required flags and preset mapping table", async () => {
		const result = await runInferenceCli(["--help"]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(0);

		const help = `${result.stdout}\n${result.stderr}`;
		expect(help).toContain("--level");
		expect(help).toContain("--fast");
		expect(help).toContain("--standard");
		expect(help).toContain("--smart");
		expect(help).toContain("--server-url");
		expect(help).toContain("--reuse-verified-loopback");
		expect(help).toContain("--trust-server");
		expect(help).toContain("--allow-non-loopback-auth");
		expect(help).toContain("--allow-insecure-http-auth");
		expect(help).toContain("--probe-timeout-ms");
		expect(help).toContain("--probe-max-bytes");
		expect(help).toContain("--start-timeout-ms");
		expect(help).toContain("reasoningEffort");
		expect(help).toContain("textVerbosity");
		expect(help).toContain("steps");
	});

	test("conflicting level selectors fail with usage exit code 2", async () => {
		const result = await runInferenceCli([
			"--smart",
			"--level",
			"fast",
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("conflict");
	});

	test("parse errors fail with usage exit code 2", async () => {
		const result = await runInferenceCli([
			"--timeout",
			"not-a-number",
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);
		expect(result.stdout).toBe("");
	});

	test("stderr diagnostics redact local /Users paths", async () => {
		const result = await runInferenceCli([
			"--timeout",
			"/Users/example/private/token.txt",
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);
		expect(result.stdout).not.toContain("/Users/");
		expect(result.stderr).not.toContain("/Users/");
	});

	test("stderr redacts bearer token in Authorization header values", async () => {
		const result = await runInferenceCli([
			"--timeout",
			"Authorization: Bearer SECRET_TOKEN",
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);
		expect(result.stdout).not.toContain("SECRET_TOKEN");
		expect(result.stderr).not.toContain("SECRET_TOKEN");
	});

	test("stderr redacts basic token in Authorization header values", async () => {
		const result = await runInferenceCli([
			"--timeout",
			"Authorization: Basic SECRET_B64",
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);
		expect(result.stdout).not.toContain("SECRET_B64");
		expect(result.stderr).not.toContain("SECRET_B64");
	});

	test("stderr redacts bearer token in proxy-authorization header values", async () => {
		const result = await runInferenceCli([
			"--timeout",
			"proxy-authorization: Bearer SECRET_TOKEN",
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);
		expect(result.stdout).not.toContain("SECRET_TOKEN");
		expect(result.stderr).not.toContain("SECRET_TOKEN");
	});

	test("stderr redacts basic token in proxy-authorization header values", async () => {
		const result = await runInferenceCli([
			"--timeout",
			"proxy-authorization: Basic SECRET_B64",
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);
		expect(result.stdout).not.toContain("SECRET_B64");
		expect(result.stderr).not.toContain("SECRET_B64");
	});

	test("parse errors redact env-style OPENAI_API_KEY secrets", async () => {
		const result = await runInferenceCli([
			"--probe-timeout-ms",
			"OPENAI_API_KEY=SECRET_TOKEN",
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);
		expect(result.stdout).not.toContain("OPENAI_API_KEY=SECRET_TOKEN");
		expect(result.stderr).not.toContain("OPENAI_API_KEY=SECRET_TOKEN");
		expect(result.stdout).not.toContain("SECRET_TOKEN");
		expect(result.stderr).not.toContain("SECRET_TOKEN");
	});

	test("parse errors redact env-style OPENCODE_SERVER_PASSWORD secrets", async () => {
		const result = await runInferenceCli([
			"--probe-timeout-ms",
			"OPENCODE_SERVER_PASSWORD=SECRET_TOKEN",
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);
		expect(result.stdout).not.toContain(
			"OPENCODE_SERVER_PASSWORD=SECRET_TOKEN",
		);
		expect(result.stderr).not.toContain(
			"OPENCODE_SERVER_PASSWORD=SECRET_TOKEN",
		);
		expect(result.stdout).not.toContain("SECRET_TOKEN");
		expect(result.stderr).not.toContain("SECRET_TOKEN");
	});

	test("parse errors redact JSON authorization bearer secrets", async () => {
		const result = await runInferenceCli([
			"--probe-timeout-ms",
			'{"authorization":"Bearer SECRET_TOKEN"}',
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);
		expect(result.stdout).not.toContain(
			'{"authorization":"Bearer SECRET_TOKEN"}',
		);
		expect(result.stderr).not.toContain(
			'{"authorization":"Bearer SECRET_TOKEN"}',
		);
		expect(result.stdout).not.toContain("SECRET_TOKEN");
		expect(result.stderr).not.toContain("SECRET_TOKEN");
	});

	test("parse errors redact JSON proxy-authorization bearer secrets", async () => {
		const result = await runInferenceCli([
			"--probe-timeout-ms",
			'{"proxy-authorization":"Bearer SECRET_TOKEN"}',
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);
		expect(result.stdout).not.toContain(
			'{"proxy-authorization":"Bearer SECRET_TOKEN"}',
		);
		expect(result.stderr).not.toContain(
			'{"proxy-authorization":"Bearer SECRET_TOKEN"}',
		);
		expect(result.stdout).not.toContain("SECRET_TOKEN");
		expect(result.stderr).not.toContain("SECRET_TOKEN");
	});

	test("parse errors redact JSON proxy-authorization basic secrets", async () => {
		const result = await runInferenceCli([
			"--probe-timeout-ms",
			'{"proxy-authorization":"Basic SECRET_B64"}',
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);
		expect(result.stdout).not.toContain(
			'{"proxy-authorization":"Basic SECRET_B64"}',
		);
		expect(result.stderr).not.toContain(
			'{"proxy-authorization":"Basic SECRET_B64"}',
		);
		expect(result.stdout).not.toContain("SECRET_B64");
		expect(result.stderr).not.toContain("SECRET_B64");
	});

	test("--json writes exactly one parseable JSON object to stdout", async () => {
		const result = await runInferenceCli([
			"--json",
			"--level",
			"fast",
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(0);

		const parsed = parseSingleJsonObject(result.stdout);
		expect(parsed).toEqual({ ok: true });
	});

	test("-- delimiter allows prompts beginning with --", async () => {
		const result = await runInferenceCli([
			"--json",
			"--level",
			"fast",
			"--server-url",
			baseUrl,
			"--",
			"system prompt",
			"--prompt-begins-with-dashes",
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(0);

		const parsed = parseSingleJsonObject(result.stdout);
		expect(parsed).toEqual({ ok: "dash" });
	});

	test("--json runtime failure emits one JSON object to stdout", async () => {
		const result = await runInferenceCli([
			"--json",
			"--level",
			"fast",
			"system prompt",
			"force runtime failure",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(1);

		const parsed = parseSingleJsonObject(result.stdout);
		expect(parsed.success).toBe(false);
		expect(parsed.code).toBe("runtime");
	});

	test("--json usage errors emit one JSON object to stdout", async () => {
		const result = await runInferenceCli([
			"--json",
			"--smart",
			"--level",
			"fast",
			"system prompt",
			"user prompt",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(2);

		const parsed = parseSingleJsonObject(result.stdout);
		expect(parsed.success).toBe(false);
		expect(parsed.code).toBe("usage");
	});

	test("--json SIGTERM abort emits one JSON object to stdout", async () => {
		const result = await runInferenceCli(
			[
				"--json",
				"--level",
				"smart",
				"--timeout",
				"20000",
				"system prompt",
				"force delayed response",
				"--server-url",
				baseUrl,
			],
			{ signalAfterMs: 100, signal: "SIGTERM" },
		);

		expect(result.code).toBe(1);

		const parsed = parseSingleJsonObject(result.stdout);
		expect(parsed.success).toBe(false);
		expect(parsed.code).toBe("abort");
	});

	test("runtime diagnostics are emitted to stderr, not stdout", async () => {
		const result = await runInferenceCli([
			"--level",
			"fast",
			"system prompt",
			"force runtime failure",
			"--server-url",
			baseUrl,
		]);

		expect(result.signal).toBeNull();
		expect(result.code).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("Error:");
	});

	test("SIGTERM abort exits with code 1 and writes diagnostics to stderr", async () => {
		const result = await runInferenceCli(
			[
				"--level",
				"smart",
				"--timeout",
				"20000",
				"system prompt",
				"force delayed response",
				"--server-url",
				baseUrl,
			],
			{ signalAfterMs: 100, signal: "SIGTERM" },
		);

		expect(result.code).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("Aborted by SIGTERM");
	});
});
