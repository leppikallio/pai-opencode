import { describe, expect, test } from "bun:test";

import { createServerConnection } from "../../skills/PAI/Tools/opencode-server-connection";

describe("opencode-server-connection", () => {
	test("probe treats 302 as not_opencode", async () => {
		const server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: () =>
				new Response("", { status: 302, headers: { location: "/" } }),
		});

		const controller = new AbortController();
		try {
			await expect(
				createServerConnection(
					{
						signal: controller.signal,
						explicitServerUrl: `http://127.0.0.1:${server.port}`,
						probeTimeoutMs: 200,
						probeMaxBytes: 1024,
						trustServer: false,
					},
					{
						// ensure it doesn't try to start a server in this test
						isPortFree: async () => false,
						createServer: async () => {
							throw new Error("should not start");
						},
						withOpencodePath: async (fn) => fn(),
						createClient: ((args: any) => args) as any,
					},
				),
			).rejects.toThrow(/not a verified OpenCode/);
		} finally {
			server.stop(true);
		}
	});

	test("explicit non-loopback never starts server and fails closed", async () => {
		const controller = new AbortController();
		await expect(
			createServerConnection(
				{
					signal: controller.signal,
					explicitServerUrl: "https://nonloopback.example:1234",
					probeTimeoutMs: 50,
				},
				{
					fetchFn: async () => new Response("no", { status: 404 }),
					createServer: async () => {
						throw new Error("should not start");
					},
					withOpencodePath: async (fn) => fn(),
					createClient: ((args: any) => args) as any,
				},
			),
		).rejects.toThrow(/not an OpenCode/);
	});

	test("non-loopback auth is never sent on first probe", async () => {
		const controller = new AbortController();
		let calls = 0;

		await expect(
			createServerConnection(
				{
					signal: controller.signal,
					explicitServerUrl: "https://nonloopback.example:1234",
					trustServer: true,
					allowNonLoopbackAuth: true,
					authHeader: "Basic Zm9vOmJhcg==",
					probeTimeoutMs: 50,
				},
				{
					fetchFn: async (_url, init) => {
						calls++;
						const auth = new Headers(init?.headers).get("authorization");
						const dir = new Headers(init?.headers).get("x-opencode-directory");
						expect(dir).toBeNull();

						if (calls === 1) {
							expect(auth).toBeNull();
							return new Response("", { status: 401 });
						}

						expect(auth).toBe("Basic Zm9vOmJhcg==");
						return new Response('{"healthy":true,"version":"1"}', {
							status: 200,
							headers: { "content-type": "application/json" },
						});
					},
					createServer: async () => {
						throw new Error("should not start");
					},
					withOpencodePath: async (fn) => fn(),
					createClient: ((args: any) => args) as any,
				},
			),
		).resolves.toBeTruthy();
	});

	test("explicit loopback starts when port is free and cleanup is idempotent", async () => {
		const controller = new AbortController();
		let closeCalls = 0;
		const conn = await createServerConnection(
			{
				signal: controller.signal,
				explicitServerUrl: "http://127.0.0.1:45678",
			},
			{
				isPortFree: async () => true,
				withOpencodePath: async (fn) => fn(),
				createServer: async () => ({
					url: "http://127.0.0.1:45678",
					close: async () => {
						closeCalls++;
					},
				}),
				createClient: ((args: any) => args) as any,
			},
		);

		expect(conn.started).toBe(true);
		await conn.cleanup();
		await conn.cleanup();
		expect(closeCalls).toBe(1);
	});

	test("probe enforces max bytes cap", async () => {
		const payload = JSON.stringify({
			healthy: true,
			version: "1",
			pad: "x".repeat(5000),
		});
		const server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (req) => {
				if (req.url.endsWith("/global/health")) {
					return new Response(payload, {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				return new Response("no", { status: 404 });
			},
		});

		const controller = new AbortController();
		try {
			await expect(
				createServerConnection(
					{
						signal: controller.signal,
						explicitServerUrl: `http://127.0.0.1:${server.port}`,
						probeMaxBytes: 128,
					},
					{
						isPortFree: async () => false,
						createServer: async () => {
							throw new Error("should not start");
						},
						withOpencodePath: async (fn) => fn(),
						createClient: ((args: any) => args) as any,
					},
				),
			).rejects.toThrow(/not a verified OpenCode/);
		} finally {
			server.stop(true);
		}
	});

	test("owned server starts with PAI_CC_HOOKS_DISABLED set", async () => {
		const controller = new AbortController();
		const initial = process.env.PAI_CC_HOOKS_DISABLED;
		try {
			await createServerConnection(
				{
					signal: controller.signal,
					explicitServerUrl: "http://127.0.0.1:45679",
				},
				{
					isPortFree: async () => true,
					withOpencodePath: async (fn) => fn(),
					createServer: async () => {
						expect(process.env.PAI_CC_HOOKS_DISABLED).toBe("1");
						return {
							url: "http://127.0.0.1:45679",
							close: async () => {},
						};
					},
					createClient: ((args: any) => args) as any,
				},
			);
		} finally {
			expect(process.env.PAI_CC_HOOKS_DISABLED).toBe(initial);
		}
	});
});
