import type { ToolContext } from "@opencode-ai/plugin";

import { ensureScratchpadSession } from "../../lib/scratchpad";
import { getSessionRootId, setSessionRootId } from "../shared/session-root";

export type CarrierClient = {
	session?: {
		get?: (options: unknown) => Promise<unknown>;
		create?: (options?: unknown) => Promise<unknown>;
		prompt?: (options: unknown) => Promise<unknown>;
		promptAsync?: (options: unknown) => Promise<unknown>;
	};
};

export type TaskToolArgs = {
	description: string;
	prompt: string;
	subagent_type: string;
	command?: string;
	task_id?: string;
	run_in_background?: boolean;
};

export type ForegroundTaskResult = {
	title: string;
	metadata: {
		sessionId: string;
		model: unknown;
	};
	output: string;
};

const SCRATCHPAD_BINDING_MARKER = "PAI SCRATCHPAD (Binding)";
const SCRATCHPAD_RULES = [
	"Rules:",
	"- If asked for ScratchpadDir, answer with the value above.",
	"- Do NOT run tools (Read/Glob/Bash/etc) to discover it.",
];

type PromptPart =
	| { type: "text"; text: string }
	| { type: "agent"; text: string }
	| { type: "file"; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getAnyProp(obj: unknown, key: string): unknown {
	return isRecord(obj) ? obj[key] : undefined;
}

function getStringProp(obj: unknown, key: string): string | undefined {
	if (!isRecord(obj)) return undefined;
	const value = obj[key];
	return typeof value === "string" ? value : undefined;
}

function resultHasError(result: unknown): boolean {
	return isRecord(result) && getAnyProp(result, "error") != null;
}

function extractSessionId(result: unknown): string {
	const data = getAnyProp(result, "data");
	const fromData = getStringProp(data, "id");
	if (fromData) return fromData;
	return getStringProp(result, "id") ?? "";
}

function getContextSessionId(ctx: ToolContext): string {
	const value =
		(ctx as ToolContext & { sessionID?: unknown; sessionId?: unknown })
			.sessionID ??
		(ctx as ToolContext & { sessionID?: unknown; sessionId?: unknown })
			.sessionId;
	return typeof value === "string" ? value : "";
}

function getContextDirectory(ctx: ToolContext): string {
	const value = (ctx as ToolContext & { directory?: unknown }).directory;
	return typeof value === "string" ? value : process.cwd();
}

function getContextAsk(ctx: ToolContext):
	| ((request: unknown) => Promise<unknown>)
	| undefined {
	const ask = (
		ctx as ToolContext & { ask?: (request: unknown) => Promise<unknown> }
	).ask;
	return typeof ask === "function" ? ask : undefined;
}

function getBypassAgentCheck(ctx: ToolContext): boolean {
	const extra = getAnyProp(ctx, "extra");
	return isRecord(extra) && extra.bypassAgentCheck === true;
}

function extractAgentMentions(prompt: string): string[] {
	const mentions: string[] = [];
	const mentionPattern = /(^|[\s(])@([A-Za-z][A-Za-z0-9_-]*)\b/g;

	for (const match of prompt.matchAll(mentionPattern)) {
		const mention = (match[2] ?? "").trim().toLowerCase();
		if (mention) {
			mentions.push(mention);
		}
	}

	return mentions;
}

function hasExplicitAgentMention(args: TaskToolArgs): boolean {
	const mentions = extractAgentMentions(args.prompt ?? "");
	if (mentions.length === 0) {
		return false;
	}

	const normalizedSubagent = args.subagent_type.trim().toLowerCase();
	if (normalizedSubagent && mentions.includes(normalizedSubagent)) {
		return true;
	}

	return mentions.includes("general") || mentions.includes("agent");
}

function buildScratchpadBinding(scratchpadDir: string): string {
	return [
		SCRATCHPAD_BINDING_MARKER,
		`ScratchpadDir: ${scratchpadDir}`,
		...SCRATCHPAD_RULES,
	].join("\n");
}

function prefixPromptWithScratchpadBinding(
	prompt: string,
	scratchpadDir: string,
): string {
	if (prompt.includes(SCRATCHPAD_BINDING_MARKER)) {
		return prompt;
	}

	const binding = buildScratchpadBinding(scratchpadDir);
	if (!prompt.trim()) {
		return binding;
	}

	return `${binding}\n\n${prompt}`;
}

function formatTaskResult(taskId: string, text: string): string {
	return `task_id: ${taskId}\n<task_result>${text}</task_result>`;
}

function isLikelyFileReference(reference: string): boolean {
	return (
		reference.includes("/") ||
		reference.includes(".") ||
		reference.startsWith("~")
	);
}

function coalesceTextPromptParts(parts: PromptPart[]): PromptPart[] {
	const compacted: PromptPart[] = [];

	for (const part of parts) {
		if (part.type !== "text") {
			compacted.push(part);
			continue;
		}

		if (part.text.length === 0) {
			continue;
		}

		const previousPart = compacted[compacted.length - 1];
		if (previousPart?.type === "text") {
			previousPart.text += part.text;
			continue;
		}

		compacted.push(part);
	}

	if (compacted.length === 0) {
		return [{ type: "text", text: "" }];
	}

	return compacted;
}

export function resolvePromptPartsWithRoutingMentions(prompt: string): PromptPart[] {
	const resolvedPrompt = prompt ?? "";
	const mentionPattern = /(^|[\s(])@([A-Za-z0-9_./-]+)/g;
	const parts: PromptPart[] = [];
	let cursor = 0;

	for (const match of resolvedPrompt.matchAll(mentionPattern)) {
		const leading = match[1] ?? "";
		const reference = (match[2] ?? "").trim();
		const matchIndex = match.index ?? 0;
		const mentionStart = matchIndex + leading.length;

		if (mentionStart > cursor) {
			parts.push({ type: "text", text: resolvedPrompt.slice(cursor, mentionStart) });
		}

		if (!reference) {
			parts.push({ type: "text", text: "@" });
			cursor = mentionStart + 1;
			continue;
		}

		parts.push(
			isLikelyFileReference(reference)
				? { type: "file", text: reference }
				: { type: "agent", text: reference },
		);
		cursor = mentionStart + 1 + reference.length;
	}

	if (cursor < resolvedPrompt.length) {
		parts.push({ type: "text", text: resolvedPrompt.slice(cursor) });
	}

	if (parts.length === 0) {
		return [{ type: "text", text: resolvedPrompt }];
	}

	return coalesceTextPromptParts(parts);
}

function extractTextFromParts(parts: unknown): string {
	if (!Array.isArray(parts)) return "";
	return parts
		.filter(
			(part) =>
				isRecord(part) &&
				(part.type === "text" || part.type === "reasoning") &&
				typeof part.text === "string",
		)
		.map((part) => String((part as { text: string }).text))
		.join("")
		.trim();
}

async function extractAssistantText(promptResult: unknown): Promise<string> {
	const data = getAnyProp(promptResult, "data");
	const fromData = extractTextFromParts(getAnyProp(data, "parts"));
	if (fromData) return fromData;

	const fromRoot = extractTextFromParts(getAnyProp(promptResult, "parts"));
	if (fromRoot) return fromRoot;

	const response = getAnyProp(promptResult, "response");
	if (!isRecord(response)) return "";
	const responseText = response.text;
	if (typeof responseText !== "function") return "";

	try {
		const raw = await responseText.call(response);
		if (typeof raw !== "string" || !raw.trim()) return "";
		const parsed = JSON.parse(raw);
		const fromParsedData = extractTextFromParts(
			getAnyProp(getAnyProp(parsed, "data"), "parts"),
		);
		if (fromParsedData) return fromParsedData;
		return extractTextFromParts(getAnyProp(parsed, "parts"));
	} catch {
		return "";
	}
}

function extractModelMetadata(promptResult: unknown): unknown {
	const data = getAnyProp(promptResult, "data");
	const topMetadata = getAnyProp(promptResult, "metadata");
	const dataMetadata = getAnyProp(data, "metadata");

	const candidates = [
		getAnyProp(topMetadata, "model"),
		getAnyProp(dataMetadata, "model"),
		getAnyProp(data, "model"),
		getAnyProp(promptResult, "model"),
	];

	for (const candidate of candidates) {
		if (candidate !== undefined) {
			return candidate;
		}
	}

	return {};
}

async function resolveChildSessionId(
	taskArgs: TaskToolArgs,
	client: CarrierClient,
	ctx: ToolContext,
): Promise<string> {
	const session = client.session;
	if (!session?.create) {
		throw new Error("PAI task override: client.session.create is unavailable");
	}

	const requestedTaskId = taskArgs.task_id?.trim();
	if (requestedTaskId) {
		if (typeof session.get === "function") {
			try {
				const getResult = await session.get({ path: { id: requestedTaskId } });
				if (!resultHasError(getResult)) {
					return extractSessionId(getResult) || requestedTaskId;
				}
			} catch {
				// Fall through to create for best-effort behavior.
			}
		} else {
			return requestedTaskId;
		}
	}

	const createBody: Record<string, unknown> = {
		title: taskArgs.description,
	};

	const parentSessionId = getContextSessionId(ctx).trim();
	if (parentSessionId) {
		createBody.parentID = parentSessionId;
	}

	const directory = getContextDirectory(ctx).trim();
	const createResult = await session.create({
		body: createBody,
		...(directory ? { query: { directory } } : {}),
	});

	const createdId = extractSessionId(createResult);
	if (!createdId) {
		throw new Error("PAI task override: child session creation returned no id");
	}

	return createdId;
}

export async function executeForegroundTaskWithParity(args: {
	taskArgs: TaskToolArgs;
	ctx: ToolContext;
	client: CarrierClient;
}): Promise<ForegroundTaskResult> {
	const { taskArgs, ctx, client } = args;

	if (!taskArgs.subagent_type.trim()) {
		throw new Error("PAI task override: subagent_type is required");
	}

	const shouldBypassPermissionCheck =
		getBypassAgentCheck(ctx) || hasExplicitAgentMention(taskArgs);
	if (!shouldBypassPermissionCheck) {
		const ask = getContextAsk(ctx);
		if (!ask) {
			throw new Error("PAI task override: ctx.ask is unavailable");
		}

		await ask({
			permission: "task",
			patterns: [taskArgs.subagent_type],
			always: ["*"],
			metadata: {
				description: taskArgs.description,
				subagent_type: taskArgs.subagent_type,
			},
		});
	}

	const childSessionId = await resolveChildSessionId(taskArgs, client, ctx);
	const parentSessionId = getContextSessionId(ctx);

	let promptText = taskArgs.prompt;
	if (parentSessionId) {
		const rootSessionId = getSessionRootId(parentSessionId) ?? parentSessionId;
		setSessionRootId(childSessionId, rootSessionId);
		const scratchpadDir = (await ensureScratchpadSession(rootSessionId)).dir;
		promptText = prefixPromptWithScratchpadBinding(taskArgs.prompt, scratchpadDir);
	}

	const session = client.session;
	if (!session?.prompt) {
		throw new Error("PAI task override: client.session.prompt is unavailable");
	}

	const promptResult = await session.prompt({
		path: { id: childSessionId },
		body: {
			agent: taskArgs.subagent_type,
			parts: resolvePromptPartsWithRoutingMentions(promptText),
		},
	});

	const assistantText = await extractAssistantText(promptResult);
	const model = extractModelMetadata(promptResult);

	return {
		title: taskArgs.description,
		metadata: {
			sessionId: childSessionId,
			model,
		},
		output: formatTaskResult(childSessionId, assistantText),
	};
}
