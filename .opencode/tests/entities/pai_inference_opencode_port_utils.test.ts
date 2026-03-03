import { describe, expect, test } from "bun:test";

import {
	DEFAULT_SERVER_PORT,
	findAvailablePort,
	getAvailableServerPort,
	isPortAvailable,
} from "../../skills/PAI/Tools/opencode-port-utils";

describe("opencode-port-utils", () => {
	function mustPort(server: { port?: number }): number {
		if (typeof server.port !== "number") {
			throw new Error("expected server.port to be a number");
		}
		return server.port;
	}

	async function waitForAvailable(port: number): Promise<void> {
		const startedAt = Date.now();
		while (Date.now() - startedAt < 1000) {
			if (await isPortAvailable(port, "127.0.0.1")) return;
			await Bun.sleep(10);
		}
		throw new Error(`port did not become available: ${port}`);
	}

	test("isPortAvailable returns false for occupied port and true after stop", async () => {
		const blocker = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: () => new Response("blocked"),
		});
		const port = mustPort(blocker);

		try {
			expect(await isPortAvailable(port, "127.0.0.1")).toBe(false);
		} finally {
			blocker.stop(true);
		}

		await waitForAvailable(port);
		expect(await isPortAvailable(port, "127.0.0.1")).toBe(true);
	});

	test("findAvailablePort returns startPort when available", async () => {
		const blocker = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: () => new Response("blocked"),
		});
		const port = mustPort(blocker);
		blocker.stop(true);

		await waitForAvailable(port);
		expect(await findAvailablePort(port, "127.0.0.1")).toBe(port);
	});

	test("findAvailablePort skips blocked ports", async () => {
		const blocker = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: () => new Response("blocked"),
		});
		const blockedPort = mustPort(blocker);

		try {
			const result = await findAvailablePort(blockedPort, "127.0.0.1");
			expect(result).not.toBe(blockedPort);
			expect(result).toBeGreaterThanOrEqual(blockedPort + 1);
		} finally {
			blocker.stop(true);
		}
	});

	test("getAvailableServerPort sets wasAutoSelected when preferred blocked", async () => {
		const blocker = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: () => new Response("blocked"),
		});
		const preferredPort = mustPort(blocker);

		try {
			const result = await getAvailableServerPort(preferredPort, "127.0.0.1");
			expect(result.port).not.toBe(preferredPort);
			expect(result.wasAutoSelected).toBe(true);
		} finally {
			blocker.stop(true);
		}
	});

	test("DEFAULT_SERVER_PORT is 4096", () => {
		expect(DEFAULT_SERVER_PORT).toBe(4096);
	});
});
