import { afterAll, describe, expect, test } from "bun:test";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";

import { inference } from "../../skills/PAI/Tools/Inference";

type CapturedRequest = {
	method: string;
	path: string;
	authorization?: string;
	directoryHeader?: string;
	bodyText: string;
};

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
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

describe("PAI inference OpenCode SDK carrier", () => {
	const expectedDirectory = "/tmp/opencode dir";

	const previousDirectory = process.env.OPENCODE_DIRECTORY;
	const previousPassword = process.env.OPENCODE_SERVER_PASSWORD;
	const previousUsername = process.env.OPENCODE_SERVER_USERNAME;
	const previousOpenAIKey = process.env.OPENAI_API_KEY;

	process.env.OPENCODE_DIRECTORY = expectedDirectory;
	process.env.OPENCODE_SERVER_PASSWORD = "pw";
	delete process.env.OPENCODE_SERVER_USERNAME;
	delete process.env.OPENAI_API_KEY;

	afterAll(() => {
		if (previousDirectory === undefined) delete process.env.OPENCODE_DIRECTORY;
		else process.env.OPENCODE_DIRECTORY = previousDirectory;

		if (previousPassword === undefined)
			delete process.env.OPENCODE_SERVER_PASSWORD;
		else process.env.OPENCODE_SERVER_PASSWORD = previousPassword;

		if (previousUsername === undefined)
			delete process.env.OPENCODE_SERVER_USERNAME;
		else process.env.OPENCODE_SERVER_USERNAME = previousUsername;

		if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = previousOpenAIKey;
	});

	test("creates session, prompts, and deletes with SDK carrier", async () => {
		const requests: CapturedRequest[] = [];

		const server = createServer(async (req, res) => {
			const path = req.url || "/";
			const method = req.method || "";
			const bodyText = await readBody(req);
			const directoryHeader = req.headers["x-opencode-directory"];
			const directoryValue = Array.isArray(directoryHeader)
				? directoryHeader[0]
				: directoryHeader;
			const authHeader = req.headers.authorization;

			requests.push({
				method,
				path,
				authorization: authHeader,
				directoryHeader: directoryValue,
				bodyText,
			});

			if (method === "GET" && path === "/global/health") {
				if (!authHeader) {
					await writeJson(res, 401, { error: "auth required" });
					return;
				}
				await writeJson(res, 200, { healthy: true, version: "test" });
				return;
			}

			if (directoryValue !== expectedDirectory) {
				await writeJson(res, 400, { error: "missing x-opencode-directory" });
				return;
			}

			if (authHeader !== "Basic b3BlbmNvZGU6cHc=") {
				await writeJson(res, 401, { error: "bad auth" });
				return;
			}

			if (method === "POST" && path === "/session") {
				await writeJson(res, 200, { id: "S1" });
				return;
			}

			if (method === "POST" && path === "/session/S1/message") {
				await writeJson(res, 200, {
					info: { id: "M1", sessionID: "S1", role: "assistant" },
					parts: [{ type: "text", text: "hello" }],
				});
				return;
			}

			if (method === "DELETE" && path === "/session/S1") {
				await writeJson(res, 200, true);
				return;
			}

			await writeJson(res, 404, { error: "not found" });
		});

		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", () => resolve()),
		);
		const address = server.address();
		if (!address || typeof address === "string") {
			server.close();
			throw new Error("failed to get test server address");
		}

		try {
			const result = await inference({
				serverUrl: `http://127.0.0.1:${address.port}`,
				systemPrompt: "x",
				userPrompt: "y",
				level: "fast",
			});

			expect(result.success).toBe(true);
			expect(result.output.toLowerCase()).toContain("hello");
			expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
				"GET /global/health",
				"GET /global/health",
				"POST /session",
				"POST /session/S1/message",
				"DELETE /session/S1",
			]);

			const createRequest = requests.find(
				(r) => r.method === "POST" && r.path === "/session",
			);
			expect(createRequest).toBeDefined();
			if (!createRequest) {
				throw new Error("missing create request");
			}
			const createBody = JSON.parse(createRequest.bodyText) as {
				permission?: Array<{
					permission?: string;
					pattern?: string;
					action?: string;
				}>;
			};
			expect(createBody.permission).toEqual([
				{ permission: "*", pattern: "*", action: "deny" },
			]);

			const promptRequest = requests.find(
				(r) => r.method === "POST" && r.path === "/session/S1/message",
			);
			expect(promptRequest).toBeDefined();
			if (!promptRequest) {
				throw new Error("missing prompt request");
			}
			const promptBody = JSON.parse(promptRequest.bodyText) as {
				system?: string;
				parts?: Array<{ type?: string; text?: string }>;
				tools?: unknown;
			};
			expect(promptBody.system).toContain("x");
			expect(promptBody.parts).toEqual([{ type: "text", text: "y" }]);
			expect(promptBody.tools).toEqual({});
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	test("returns failure on prompt error and still deletes session", async () => {
		const requests: CapturedRequest[] = [];

		const server = createServer(async (req, res) => {
			const path = req.url || "/";
			const method = req.method || "";
			const bodyText = await readBody(req);
			const directoryHeader = req.headers["x-opencode-directory"];
			const directoryValue = Array.isArray(directoryHeader)
				? directoryHeader[0]
				: directoryHeader;
			const authHeader = req.headers.authorization;

			requests.push({
				method,
				path,
				authorization: authHeader,
				directoryHeader: directoryValue,
				bodyText,
			});

			if (method === "GET" && path === "/global/health") {
				if (!authHeader) {
					await writeJson(res, 401, { error: "auth required" });
					return;
				}
				await writeJson(res, 200, { healthy: true, version: "test" });
				return;
			}

			if (directoryValue !== expectedDirectory) {
				await writeJson(res, 400, { error: "missing x-opencode-directory" });
				return;
			}

			if (authHeader !== "Basic b3BlbmNvZGU6cHc=") {
				await writeJson(res, 401, { error: "bad auth" });
				return;
			}

			if (method === "POST" && path === "/session") {
				await writeJson(res, 200, { id: "S1" });
				return;
			}

			if (method === "POST" && path === "/session/S1/message") {
				await writeJson(res, 500, { error: "prompt failed" });
				return;
			}

			if (method === "DELETE" && path === "/session/S1") {
				await writeJson(res, 200, true);
				return;
			}

			await writeJson(res, 404, { error: "not found" });
		});

		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", () => resolve()),
		);
		const address = server.address();
		if (!address || typeof address === "string") {
			server.close();
			throw new Error("failed to get test server address");
		}

		try {
			const result = await inference({
				serverUrl: `http://127.0.0.1:${address.port}`,
				systemPrompt: "x",
				userPrompt: "y",
				level: "fast",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBeTruthy();
			expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
				"GET /global/health",
				"GET /global/health",
				"POST /session",
				"POST /session/S1/message",
				"DELETE /session/S1",
			]);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
