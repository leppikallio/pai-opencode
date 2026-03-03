import { describe, expect, mock, test } from "bun:test";

import { inference } from "../../skills/PAI/Tools/Inference";

describe("PAI Inference autostart wiring", () => {
	test("routes through createServerConnection and awaits cleanup", async () => {
		const cleanup = mock(async () => {});

		const createServerConnection = mock(async () => ({
			baseUrl: "http://127.0.0.1:1",
			started: false,
			cleanup,
			client: {
				session: {
					create: async () => ({
						data: { id: "S1" },
						response: new Response(null, { status: 200 }),
					}),
					prompt: async () => ({
						data: { parts: [{ type: "text", text: "ok" }] },
						response: new Response(null, {
							status: 200,
							headers: { "x-request-id": "R" },
						}),
					}),
					delete: async () => ({
						data: true,
						response: new Response(null, { status: 200 }),
					}),
				},
			},
		}));

		const result = await inference(
			{
				serverUrl: "http://127.0.0.1:4096",
				systemPrompt: "x",
				userPrompt: "y",
				level: "fast",
			},
			{ createServerConnection },
		);

		expect(result.success).toBe(true);
		expect(result.output).toBe("ok");
		expect(createServerConnection).toHaveBeenCalledTimes(1);
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	test("aborts on signal and still awaits owned cleanup", async () => {
		const cleanup = mock(async () => {});
		const sessionCreate = mock(
			async (_input: unknown, opts?: { signal?: AbortSignal }) =>
				new Promise<never>((_resolve, reject) => {
					const signal = opts?.signal;
					if (!signal) {
						reject(new Error("missing signal"));
						return;
					}

					const onAbort = () =>
						reject(new DOMException("aborted", "AbortError"));
					if (signal.aborted) {
						onAbort();
						return;
					}

					signal.addEventListener("abort", onAbort, { once: true });
				}),
		);

		const createServerConnection = mock(async () => ({
			baseUrl: "http://127.0.0.1:1",
			started: true,
			cleanup,
			client: {
				session: {
					create: sessionCreate,
					prompt: async () => ({
						data: { parts: [{ type: "text", text: "unexpected" }] },
						response: new Response(null, { status: 200 }),
					}),
					delete: async () => ({
						data: true,
						response: new Response(null, { status: 200 }),
					}),
				},
			},
		}));

		const controller = new AbortController();
		const pending = inference(
			{
				serverUrl: "http://127.0.0.1:4096",
				systemPrompt: "x",
				userPrompt: "y",
				level: "fast",
				timeout: 5000,
				signal: controller.signal,
			},
			{ createServerConnection },
		);

		controller.abort();

		const result = await pending;
		expect(result.success).toBe(false);
		expect(result.error).toContain("aborted");
		expect(createServerConnection).toHaveBeenCalledTimes(1);
		expect(cleanup).toHaveBeenCalledTimes(1);
	});
});
