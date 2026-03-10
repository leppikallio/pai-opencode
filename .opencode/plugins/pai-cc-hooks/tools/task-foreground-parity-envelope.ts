export type ForegroundTaskParityMetadata = {
	sessionId: string;
	model: unknown;
};

export type ForegroundTaskParityEnvelope = {
	title: string;
	metadata: ForegroundTaskParityMetadata;
	output: string;
};

const ENVELOPE_PREFIX = "<pai-task-foreground-parity-v1>";
const ENVELOPE_SUFFIX = "</pai-task-foreground-parity-v1>";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizeDecodedEnvelope(
	decoded: unknown,
	output: string,
): ForegroundTaskParityEnvelope | null {
	if (!isRecord(decoded)) {
		return null;
	}

	const title = decoded.title;
	const metadata = decoded.metadata;
	if (typeof title !== "string" || !isRecord(metadata)) {
		return null;
	}

	const sessionId = metadata.sessionId;
	if (typeof sessionId !== "string") {
		return null;
	}

	return {
		title,
		metadata: {
			sessionId,
			model: metadata.model,
		},
		output,
	};
}

export function encodeForegroundTaskParityEnvelope(
	payload: ForegroundTaskParityEnvelope,
): string {
	const encoded = Buffer.from(
		JSON.stringify({
			title: payload.title,
			metadata: payload.metadata,
		}),
		"utf8",
	).toString("base64");

	return `${ENVELOPE_PREFIX}${encoded}${ENVELOPE_SUFFIX}\n${payload.output}`;
}

export function decodeForegroundTaskParityEnvelope(
	value: string,
): ForegroundTaskParityEnvelope | null {
	const pattern = new RegExp(
		`^${ENVELOPE_PREFIX}([A-Za-z0-9+/=]+)${ENVELOPE_SUFFIX}\\n?`,
	);
	const match = value.match(pattern);
	if (!match) {
		return null;
	}

	const encoded = match[1] ?? "";
	const bodyStart = match[0].length;
	const output = value.slice(bodyStart);

	try {
		const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
		return normalizeDecodedEnvelope(decoded, output);
	} catch {
		return null;
	}
}
