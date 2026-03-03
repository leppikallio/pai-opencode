export const DEFAULT_SERVER_PORT = 4096;

export async function isPortAvailable(
	port: number,
	hostname: string,
): Promise<boolean> {
	let server: ReturnType<typeof Bun.serve> | null = null;

	try {
		server = Bun.serve({
			hostname,
			port,
			fetch: () => new Response("ok"),
		});
		return true;
	} catch {
		return false;
	} finally {
		server?.stop(true);
	}
}

export async function findAvailablePort(
	startPort: number,
	hostname: string,
	maxAttempts = 20,
): Promise<number> {
	for (let i = 0; i < maxAttempts; i++) {
		const port = startPort + i;
		if (await isPortAvailable(port, hostname)) return port;
	}

	throw new Error(
		`No available port found starting at ${startPort} after ${maxAttempts} attempts`,
	);
}

export async function getAvailableServerPort(
	preferredPort: number,
	hostname: string,
): Promise<{ port: number; wasAutoSelected: boolean }> {
	if (await isPortAvailable(preferredPort, hostname)) {
		return { port: preferredPort, wasAutoSelected: false };
	}

	const port = await findAvailablePort(preferredPort + 1, hostname);
	return { port, wasAutoSelected: true };
}
