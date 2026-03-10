import { type ToolContext, tool } from "@opencode-ai/plugin";

import { ensureScratchpadSession } from "../../lib/scratchpad";
import {
	PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS,
	resolvePaiOrchestrationFeatureFlags,
} from "../feature-flags";
import { getSessionRootId, setSessionRootId } from "../shared/session-root";

import {
	type CarrierClient,
	executeForegroundTaskWithParity,
	type TaskToolArgs,
} from "./task-foreground-parity";
import { encodeForegroundTaskParityEnvelope } from "./task-foreground-parity-envelope";

import {
	type RecordBackgroundTaskLaunchArgs,
	type RecordBackgroundTaskLaunchErrorArgs,
	type FindBackgroundTaskByTaskIdArgs,
	type BackgroundTaskRecord,
	findBackgroundTaskByTaskId as findBackgroundTaskByTaskIdDefault,
	recordBackgroundTaskLaunch as recordBackgroundTaskLaunchDefault,
	recordBackgroundTaskLaunchError as recordBackgroundTaskLaunchErrorDefault,
} from "./background-task-state";
import {
	BackgroundConcurrencyCancelledError,
	BackgroundConcurrencySaturationError,
	deriveBackgroundConcurrencyGroup,
	getBackgroundConcurrencyManager,
	type BackgroundConcurrencyLease,
	type BackgroundConcurrencyManager,
} from "../background/concurrency";

type RecordBackgroundTaskLaunchFn = (
	args: RecordBackgroundTaskLaunchArgs,
) => Promise<void>;
type RecordBackgroundTaskLaunchErrorFn = (
	args: RecordBackgroundTaskLaunchErrorArgs,
) => Promise<void>;
type FindBackgroundTaskByTaskIdFn = (
	args: FindBackgroundTaskByTaskIdArgs,
) => Promise<BackgroundTaskRecord | null>;

const TASK_TOOL_DESCRIPTION = [
	"Launch a subagent task while preserving native OpenCode routing cues.",
	"",
	"Routing-critical guidance:",
	"- Explicit user mentions like @general / @<agent> are routing intent and should delegate through task.",
	"- Foreground execution remains stock-equivalent by default.",
	"- run_in_background:true is an explicit PAI extension for async launch.",
	"",
	"Usage notes:",
	"- description: concise task title shown to the UI",
	"- prompt: full instructions for the delegated agent",
	"- subagent_type: target agent name",
	"- task_id: continue an existing delegated session",
].join("\n");

const SCRATCHPAD_BINDING_MARKER = "PAI SCRATCHPAD (Binding)";
const SCRATCHPAD_RULES = [
	"Rules:",
	"- If asked for ScratchpadDir, answer with the value above.",
	"- Do NOT run tools (Read/Glob/Bash/etc) to discover it.",
];

function buildBackgroundTaskId(childSessionId: string): string {
	return `bg_${childSessionId}`;
}

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

function getContextBypassAgentCheck(ctx: ToolContext): boolean {
	const extra = getAnyProp(ctx, "extra");
	return isRecord(extra) && extra.bypassAgentCheck === true;
}

function getNestedString(source: unknown, path: string[]): string | undefined {
	let current: unknown = source;
	for (const segment of path) {
		if (!isRecord(current)) {
			return undefined;
		}
		current = current[segment];
	}

	return typeof current === "string" ? current : undefined;
}

function extractContextProviderModel(ctx: ToolContext): {
	providerId?: string;
	modelId?: string;
} {
	const providerId =
		getNestedString(ctx, ["provider", "id"]) ??
		getNestedString(ctx, ["model", "providerID"]) ??
		getNestedString(ctx, ["model", "providerId"]) ??
		getNestedString(ctx, ["extra", "provider", "id"]) ??
		getNestedString(ctx, ["extra", "model", "providerID"]) ??
		getNestedString(ctx, ["extra", "model", "providerId"]);

	const modelId =
		getNestedString(ctx, ["model", "api", "id"]) ??
		getNestedString(ctx, ["model", "id"]) ??
		getNestedString(ctx, ["extra", "model", "api", "id"]) ??
		getNestedString(ctx, ["extra", "model", "id"]);

	return {
		providerId,
		modelId,
	};
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

function hasExplicitAgentMention(args: { prompt: string; subagentType: string }): boolean {
	const mentions = extractAgentMentions(args.prompt);
	if (mentions.length === 0) {
		return false;
	}

	const normalizedSubagent = args.subagentType.trim().toLowerCase();
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

async function resolveChildSessionId(
	args: TaskToolArgs,
	client: CarrierClient,
	ctx: ToolContext,
): Promise<string> {
	const session = client.session;
	if (!session?.create) {
		throw new Error("PAI task override: client.session.create is unavailable");
	}

	const requestedTaskId = args.task_id?.trim();
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
		title: args.description,
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

async function resolveBackgroundSession(args: {
	taskArgs: TaskToolArgs;
	ctx: ToolContext;
	client: CarrierClient;
	findBackgroundTaskByTaskId: FindBackgroundTaskByTaskIdFn;
}): Promise<{
	taskId: string;
	childSessionId: string;
	existingRecord: BackgroundTaskRecord | null;
}> {
	const { taskArgs, ctx, client, findBackgroundTaskByTaskId } = args;
	const requestedTaskId = taskArgs.task_id?.trim();
	const session = client.session;

	if (requestedTaskId) {
		const existingRecord = await findBackgroundTaskByTaskId({
			taskId: requestedTaskId,
		});
		if (existingRecord?.child_session_id) {
			return {
				taskId: existingRecord.task_id,
				childSessionId: existingRecord.child_session_id,
				existingRecord,
			};
		}

		if (typeof session?.get === "function") {
			try {
				const getResult = await session.get({ path: { id: requestedTaskId } });
				if (!resultHasError(getResult)) {
					const childSessionId = extractSessionId(getResult) || requestedTaskId;
					return {
						taskId: buildBackgroundTaskId(childSessionId),
						childSessionId,
						existingRecord: null,
					};
				}
			} catch {
				// Fall through to create.
			}
		}
	}

	if (!session?.create) {
		throw new Error("PAI task override: client.session.create is unavailable");
	}

	const childCreateResult = await session.create({
		body: {
			parentID: getContextSessionId(ctx),
			title: taskArgs.description,
		},
		query: {
			directory: getContextDirectory(ctx),
		},
	});

	const childSessionId = extractSessionId(childCreateResult);
	if (!childSessionId) {
		throw new Error(
			"PAI task override: child session creation returned no id",
		);
	}

	return {
		taskId: buildBackgroundTaskId(childSessionId),
		childSessionId,
		existingRecord: null,
	};
}

function formatTaskResult(taskId: string, text: string): string {
	return `task_id: ${taskId}\n<task_result>${text}</task_result>`;
}

function parseBooleanEnvOverride(value: string | undefined): boolean | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}

	if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
		return true;
	}

	if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
		return false;
	}

	return undefined;
}

export function isForegroundParityEnabled(env: Record<string, string | undefined> = process.env): boolean {
	const envKey =
		PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS.paiOrchestrationForegroundParityEnabled;
	const explicitOverride = parseBooleanEnvOverride(env[envKey]);
	if (explicitOverride === undefined) {
		return true;
	}

	return resolvePaiOrchestrationFeatureFlags(env)
		.paiOrchestrationForegroundParityEnabled;
}

export function isBackgroundConcurrencyEnabled(
	env: Record<string, string | undefined> = process.env,
): boolean {
	const envKey =
		PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS.paiOrchestrationConcurrencyEnabled;
	const explicitOverride = parseBooleanEnvOverride(env[envKey]);
	if (explicitOverride === undefined) {
		return resolvePaiOrchestrationFeatureFlags(env)
			.paiOrchestrationConcurrencyEnabled;
	}

	return resolvePaiOrchestrationFeatureFlags(env)
		.paiOrchestrationConcurrencyEnabled;
}

async function executeLegacyForegroundTask(args: {
	taskArgs: TaskToolArgs;
	ctx: ToolContext;
	client: CarrierClient;
}): Promise<string> {
	const { taskArgs, ctx, client } = args;

	const ask = (
		ctx as ToolContext & { ask?: (request: unknown) => Promise<unknown> }
	).ask;
	const shouldBypassPermissionCheck =
		getContextBypassAgentCheck(ctx) ||
		hasExplicitAgentMention({
			prompt: taskArgs.prompt,
			subagentType: taskArgs.subagent_type,
		});
	if (!shouldBypassPermissionCheck) {
		if (typeof ask !== "function") {
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
			parts: [{ type: "text", text: promptText }],
		},
	});

	const assistantText = await extractAssistantText(promptResult);
	return formatTaskResult(childSessionId, assistantText);
}

export function createPaiTaskTool(input: {
	client: unknown;
	$: unknown;
	recordBackgroundTaskLaunch?: RecordBackgroundTaskLaunchFn;
	recordBackgroundTaskLaunchError?: RecordBackgroundTaskLaunchErrorFn;
	findBackgroundTaskByTaskId?: FindBackgroundTaskByTaskIdFn;
	backgroundConcurrencyManager?: BackgroundConcurrencyManager;
}) {
	const client = (input.client ?? {}) as CarrierClient;
	const recordBackgroundTaskLaunch =
		input.recordBackgroundTaskLaunch ?? recordBackgroundTaskLaunchDefault;
	const recordBackgroundTaskLaunchError =
		input.recordBackgroundTaskLaunchError ??
		recordBackgroundTaskLaunchErrorDefault;
	const findBackgroundTaskByTaskId =
		input.findBackgroundTaskByTaskId ?? findBackgroundTaskByTaskIdDefault;
	const backgroundConcurrencyManager =
		input.backgroundConcurrencyManager ?? getBackgroundConcurrencyManager();

	return tool({
		description: TASK_TOOL_DESCRIPTION,
		args: {
			description: tool.schema.string(),
			prompt: tool.schema.string(),
			subagent_type: tool.schema.string(),
			command: tool.schema.string().optional(),
			task_id: tool.schema.string().optional(),
			run_in_background: tool.schema.boolean().optional(),
		},
		async execute(
			args: TaskToolArgs,
			ctx: ToolContext,
		): Promise<string> {
			if (args.run_in_background === true) {
				const parentSessionId = getContextSessionId(ctx);
				if (!parentSessionId) {
					throw new Error(
						"PAI task override: ctx.sessionID is required for run_in_background=true",
					);
				}

				const session = client.session;
				if (!session) {
					throw new Error("PAI task override: client.session is unavailable");
				}
				const promptAsync = session.promptAsync;
				const promptSync = session.prompt;
				const promptLaunch = promptAsync ?? promptSync;
				if (!promptLaunch) {
					throw new Error(
						"PAI task override: client.session.promptAsync/prompt is unavailable",
					);
				}

				const { taskId, childSessionId, existingRecord } =
					await resolveBackgroundSession({
						taskArgs: args,
						ctx,
						client,
						findBackgroundTaskByTaskId,
					});

				const rootSessionId =
					getSessionRootId(parentSessionId) ?? parentSessionId;
				setSessionRootId(childSessionId, rootSessionId);
				const scratchpadDir = (await ensureScratchpadSession(rootSessionId)).dir;
				const promptText = prefixPromptWithScratchpadBinding(
					args.prompt,
					scratchpadDir,
				);
				const concurrencyEnabled = isBackgroundConcurrencyEnabled();
				const providerModel = extractContextProviderModel(ctx);
				const concurrencyGroup =
					existingRecord?.concurrency_group ??
					deriveBackgroundConcurrencyGroup({
						providerId: providerModel.providerId,
						modelId: providerModel.modelId,
						subagentType: args.subagent_type,
					});

				await recordBackgroundTaskLaunch({
					taskId,
					taskDescription: args.description,
					childSessionId,
					parentSessionId,
					status: concurrencyEnabled ? "queued" : "running",
					concurrencyGroup,
				});

				void (async () => {
					let lease: BackgroundConcurrencyLease | null = null;
					try {
						if (concurrencyEnabled) {
							lease = await backgroundConcurrencyManager.acquire({
								group: concurrencyGroup,
								taskId,
							});

							await recordBackgroundTaskLaunch({
								taskId,
								taskDescription: args.description,
								childSessionId,
								parentSessionId,
								status: "running",
								concurrencyGroup,
							});
						}

						await Promise.resolve(
							promptLaunch.call(session, {
								path: { id: childSessionId },
								body: {
									agent: args.subagent_type,
									parts: [{ type: "text", text: promptText }],
								},
							}),
						);
					} catch (promptError: unknown) {
						if (promptError instanceof BackgroundConcurrencyCancelledError) {
							return;
						}

						const errorMessage =
							promptError instanceof BackgroundConcurrencySaturationError
								? `${promptError.message} (max queued reached)`
								: promptError instanceof Error
									? promptError.message
									: typeof promptError === "string"
										? promptError
										: String(promptError);
						const normalizedMessage =
							errorMessage.trim() || "Unknown background prompt launch error";

						try {
							await recordBackgroundTaskLaunchError({
								taskId,
								errorMessage: normalizedMessage,
							});
						} catch {
							// Best effort error marker persistence.
						}
					} finally {
						lease?.release();
					}
				})();

				const queueSnapshot = concurrencyEnabled
					? backgroundConcurrencyManager.getSnapshot(concurrencyGroup)[0]
					: undefined;
				const queueHint = queueSnapshot
					? `\nConcurrency group: ${concurrencyGroup} (active=${queueSnapshot.active}/${queueSnapshot.limit}, queued=${queueSnapshot.queued})`
					: "";

				return `Background task launched.\n\nTask ID: ${taskId}\nSession ID: ${childSessionId}\nAgent: ${args.subagent_type}${queueHint}\n\nSystem notifies on completion. Use \`background_output\` with task_id="${taskId}" to check.`;
			}

			if (isForegroundParityEnabled()) {
				const result = await executeForegroundTaskWithParity({
					taskArgs: args,
					ctx,
					client,
				});

				return encodeForegroundTaskParityEnvelope(result);
			}

			return executeLegacyForegroundTask({
				taskArgs: args,
				ctx,
				client,
			});
		},
	});
}
