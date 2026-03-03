import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { createOpencodeServer } from "@opencode-ai/sdk/v2/server";
import { withWorkingOpencodePath } from "./opencode-binary-resolver";
import {
	DEFAULT_SERVER_PORT,
	findAvailablePort,
	getAvailableServerPort,
	isPortAvailable,
} from "./opencode-port-utils";
import { withScopedProcessEnv } from "./opencode-scoped-env";

type ProbeResult = "verified" | "needs_auth" | "not_opencode";

type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

async function readBodyUpTo(
	response: Response,
	maxBytes: number,
): Promise<string> {
	if (!response.body) return "";

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;

		total += value.byteLength;
		if (total > maxBytes) {
			throw new Error("probe response exceeded max bytes");
		}
		chunks.push(value);
	}

	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(out);
}

function normalizeBaseUrl(serverUrl: string): URL {
	const url = new URL(serverUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Only http(s) server URLs are supported");
	}

	url.username = "";
	url.password = "";
	url.pathname = "";
	url.search = "";
	url.hash = "";

	if (url.hostname === "localhost") url.hostname = "127.0.0.1";
	return url;
}

function isLoopbackHostname(hostname: string): boolean {
	return hostname === "127.0.0.1" || hostname === "::1";
}

async function probeOpencodeServer(
	baseUrl: string,
	opts: {
		fetchFn: FetchFn;
		timeoutMs: number;
		maxBytes: number;
		authHeader?: string | null;
	},
): Promise<ProbeResult> {
	let url: URL;
	try {
		url = normalizeBaseUrl(baseUrl);
	} catch {
		return "not_opencode";
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

	try {
		const headers = new Headers();
		if (opts.authHeader) headers.set("authorization", opts.authHeader);

		const res = await opts.fetchFn(`${url.origin}/global/health`, {
			method: "GET",
			redirect: "manual",
			headers,
			signal: controller.signal,
		});

		if (res.status === 401 || res.status === 403) return "needs_auth";
		if (res.status >= 300 && res.status < 400) return "not_opencode";
		if (res.status !== 200) return "not_opencode";

		const contentType = res.headers.get("content-type") ?? "";
		if (!contentType.toLowerCase().includes("application/json")) {
			return "not_opencode";
		}

		const body = await readBodyUpTo(res, opts.maxBytes);
		const parsed = JSON.parse(body) as unknown;
		if (typeof parsed === "object" && parsed !== null) {
			const parsedRecord = parsed as {
				healthy?: unknown;
				version?: unknown;
			};
			if (
				parsedRecord.healthy === true &&
				typeof parsedRecord.version === "string"
			) {
				return "verified";
			}
		}
		return "not_opencode";
	} catch {
		return "not_opencode";
	} finally {
		clearTimeout(timeout);
	}
}

export type ServerConnection = {
	client: ReturnType<typeof createOpencodeClient>;
	baseUrl: string;
	started: boolean;
	cleanup: () => Promise<void>;
};

export async function createServerConnection(
	opts: {
		signal: AbortSignal;
		explicitServerUrl?: string | null;
		reuseVerifiedLoopback?: boolean;
		directory?: string;
		authHeader?: string | null;
		trustServer?: boolean;
		allowNonLoopbackAuth?: boolean;
		allowInsecureHttpAuth?: boolean;
		probeTimeoutMs?: number;
		probeMaxBytes?: number;
		hostname?: string;
		startTimeoutMs?: number;
	},
	deps?: {
		fetchFn?: FetchFn;
		createClient?: typeof createOpencodeClient;
		createServer?: typeof createOpencodeServer;
		withOpencodePath?: typeof withWorkingOpencodePath;
		isPortFree?: typeof isPortAvailable;
		findPort?: typeof findAvailablePort;
		getPort?: typeof getAvailableServerPort;
	},
): Promise<ServerConnection> {
	const fetchFn: FetchFn = deps?.fetchFn ?? fetch;
	const createClient = deps?.createClient ?? createOpencodeClient;
	const createServer = deps?.createServer ?? createOpencodeServer;
	const withOpencodePath = deps?.withOpencodePath ?? withWorkingOpencodePath;
	const isPortFree = deps?.isPortFree ?? isPortAvailable;
	const _findPort = deps?.findPort ?? findAvailablePort;
	const getPort = deps?.getPort ?? getAvailableServerPort;

	const hostname = opts.hostname ?? "127.0.0.1";
	const probeTimeoutMs = opts.probeTimeoutMs ?? 750;
	const probeMaxBytes = opts.probeMaxBytes ?? 16_384;
	const startTimeoutMs = opts.startTimeoutMs ?? 8000;

	const explicit = opts.explicitServerUrl ?? null;
	const directoryLoopback =
		opts.directory ?? process.env.OPENCODE_DIRECTORY ?? process.cwd();
	const directoryNonLoopback = opts.directory;

	async function attach(
		baseUrl: string,
		allowAuth: boolean,
	): Promise<ServerConnection> {
		const url = normalizeBaseUrl(baseUrl);
		const loopback = isLoopbackHostname(url.hostname);
		const headers: Record<string, string> = {};

		if (allowAuth && opts.authHeader) {
			headers.authorization = opts.authHeader;
		}

		const directory = loopback ? directoryLoopback : directoryNonLoopback;
		const client = createClient({
			baseUrl: url.origin,
			responseStyle: "fields",
			headers: Object.keys(headers).length ? headers : undefined,
			directory,
		} as Parameters<typeof createClient>[0]);

		return {
			client,
			baseUrl: url.origin,
			started: false,
			cleanup: async () => {},
		};
	}

	async function startOwned(port: number): Promise<{
		baseUrl: string;
		client: ReturnType<typeof createOpencodeClient>;
		cleanup: () => Promise<void>;
	}> {
		const startController = new AbortController();
		const timer = setTimeout(() => startController.abort(), startTimeoutMs);

		const onAbort = () => startController.abort();
		opts.signal.addEventListener("abort", onAbort);

		try {
			const server = await withScopedProcessEnv(
				{ PAI_CC_HOOKS_DISABLED: "1" },
				async () =>
					withOpencodePath(async () =>
						createServer({
							hostname,
							port,
							timeout: startTimeoutMs + 250,
							signal: startController.signal,
						} as Parameters<typeof createServer>[0]),
					),
			);

			const baseUrl = normalizeBaseUrl(server.url).origin;
			const client = createClient({
				baseUrl,
				responseStyle: "fields",
				directory: directoryLoopback,
			} as Parameters<typeof createClient>[0]);

			let cleaned = false;
			const cleanup = async (): Promise<void> => {
				if (cleaned) return;
				cleaned = true;
				await server.close();
			};

			return { baseUrl, client, cleanup };
		} finally {
			clearTimeout(timer);
			opts.signal.removeEventListener("abort", onAbort);
		}
	}

	if (explicit) {
		const url = normalizeBaseUrl(explicit);
		const loopback = isLoopbackHostname(url.hostname);

		if (loopback && !url.port) {
			throw new Error("Loopback server URLs must include an explicit port");
		}

		if (!loopback) {
			// Attach-only; fail closed.
			const first = await probeOpencodeServer(url.origin, {
				fetchFn,
				timeoutMs: opts.probeTimeoutMs ?? 2000,
				maxBytes: probeMaxBytes,
			});

			if (first === "verified") {
				return attach(url.origin, false);
			}

			if (first === "needs_auth") {
				if (!opts.trustServer) {
					throw new Error(
						"Server requires auth; pass --trust-server to allow auth",
					);
				}
				if (!opts.authHeader) {
					throw new Error(
						"Server requires auth; provide OPENCODE_SERVER_PASSWORD/USERNAME",
					);
				}
				if (!opts.allowNonLoopbackAuth) {
					throw new Error(
						"Refusing to send auth to non-loopback; pass --allow-non-loopback-auth",
					);
				}
				if (url.protocol === "http:" && !opts.allowInsecureHttpAuth) {
					throw new Error(
						"Refusing to send auth over http; pass --allow-insecure-http-auth",
					);
				}

				const second = await probeOpencodeServer(url.origin, {
					fetchFn,
					timeoutMs: opts.probeTimeoutMs ?? 2000,
					maxBytes: probeMaxBytes,
					authHeader: opts.authHeader,
				});

				if (second !== "verified") {
					throw new Error("Server did not verify as OpenCode after auth");
				}
				return attach(url.origin, true);
			}

			throw new Error("Explicit server URL is not an OpenCode server");
		}

		// Explicit loopback URL: start-if-free / attach-if-occupied.
		const port = Number(url.port);
		if (await isPortFree(port, url.hostname)) {
			try {
				const started = await startOwned(port);
				return {
					client: started.client,
					baseUrl: started.baseUrl,
					started: true,
					cleanup: started.cleanup,
				};
			} catch {
				// Bind race: if port became occupied, try attaching.
				if (!(await isPortFree(port, url.hostname))) {
					const probed = await probeOpencodeServer(url.origin, {
						fetchFn,
						timeoutMs: probeTimeoutMs,
						maxBytes: probeMaxBytes,
					});
					if (probed === "verified") return attach(url.origin, false);
				}
				throw new Error(
					"Failed to start owned server on explicit loopback port",
				);
			}
		}

		const probed = await probeOpencodeServer(url.origin, {
			fetchFn,
			timeoutMs: probeTimeoutMs,
			maxBytes: probeMaxBytes,
		});

		if (probed === "verified") return attach(url.origin, false);
		if (probed === "needs_auth") {
			if (!opts.trustServer) {
				throw new Error("Loopback server requires auth; pass --trust-server");
			}
			if (!opts.authHeader) {
				throw new Error("Loopback server requires auth; provide credentials");
			}
			const second = await probeOpencodeServer(url.origin, {
				fetchFn,
				timeoutMs: probeTimeoutMs,
				maxBytes: probeMaxBytes,
				authHeader: opts.authHeader,
			});
			if (second === "verified") return attach(url.origin, true);
		}
		throw new Error("Explicit loopback URL is not a verified OpenCode server");
	}

	// Auto mode.
	const preferred = DEFAULT_SERVER_PORT;

	if (opts.reuseVerifiedLoopback) {
		const occupied = !(await isPortFree(preferred, hostname));
		if (occupied) {
			const baseUrl = `http://${hostname}:${preferred}`;
			const probed = await probeOpencodeServer(baseUrl, {
				fetchFn,
				timeoutMs: probeTimeoutMs,
				maxBytes: probeMaxBytes,
			});
			if (probed === "verified") {
				// Attach without auth.
				return attach(baseUrl, false);
			}
		}
	}

	const { port } = await getPort(preferred, hostname);
	const owned = await startOwned(port);
	return {
		client: owned.client,
		baseUrl: owned.baseUrl,
		started: true,
		cleanup: owned.cleanup,
	};
}
