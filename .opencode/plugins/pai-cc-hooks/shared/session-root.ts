const rootBySession = new Map<string, string>();

function normalizeSessionId(sessionId: string): string {
	return sessionId.trim().replace(/[^A-Za-z0-9_-]/g, "");
}

export function setSessionRootId(sessionId: string, rootSessionId: string): void {
	const normalizedSessionId = normalizeSessionId(sessionId);
	const normalizedRootSessionId = normalizeSessionId(rootSessionId);
	if (!normalizedSessionId || !normalizedRootSessionId) {
		return;
	}

	rootBySession.set(normalizedSessionId, normalizedRootSessionId);
}

export function getSessionRootId(sessionId: string): string | undefined {
	const normalizedSessionId = normalizeSessionId(sessionId);
	if (!normalizedSessionId) {
		return undefined;
	}

	return rootBySession.get(normalizedSessionId);
}

export function deleteSessionRootId(sessionId: string): void {
	const normalizedSessionId = normalizeSessionId(sessionId);
	if (!normalizedSessionId) {
		return;
	}

	rootBySession.delete(normalizedSessionId);
}

export function __resetSessionRootRegistryForTests(): void {
	rootBySession.clear();
}
