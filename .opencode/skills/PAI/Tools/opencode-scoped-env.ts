type EnvOverrides = Record<string, string | undefined>;

class Mutex {
	private chain: Promise<void> = Promise.resolve();

	async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
		let release!: () => void;
		const next = new Promise<void>((resolve) => {
			release = resolve;
		});

		const previous = this.chain;
		this.chain = previous.then(() => next);

		await previous;
		try {
			return await fn();
		} finally {
			release();
		}
	}
}

const envMutex = new Mutex();

export async function withScopedProcessEnv<T>(
	overrides: EnvOverrides,
	fn: () => Promise<T>,
): Promise<T> {
	return envMutex.runExclusive(async () => {
		const previous: Record<string, string | undefined> = {};

		for (const [key, value] of Object.entries(overrides)) {
			previous[key] = process.env[key];
			if (typeof value === "undefined") {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}

		try {
			return await fn();
		} finally {
			for (const [key, value] of Object.entries(previous)) {
				if (typeof value === "undefined") {
					delete process.env[key];
				} else {
					process.env[key] = value;
				}
			}
		}
	});
}
