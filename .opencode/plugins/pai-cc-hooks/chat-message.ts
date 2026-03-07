import { confirmAskGatePrompt } from "./ask-gate";
import type { ClaudeHooksConfig } from "./claude/types";
import { executeUserPromptSubmitHooks } from "./claude/user-prompt-submit";
import { asRecord, getString } from "./session-helpers";

type ChatMessagePart = {
	type: "text" | "tool_use" | "tool_result";
	text?: string;
};

export async function handleChatMessage(args: {
	input: unknown;
	output: unknown;
	config: ClaudeHooksConfig | null;
	env?: Record<string, string>;
	cwd: string;
	resolveParentSessionId: (sessionId: string) => Promise<string | undefined>;
}): Promise<void> {
	const payload = asRecord(args.input);
	const out = asRecord(args.output);

	const partsRaw = payload.parts;
	const parts = Array.isArray(partsRaw)
		? partsRaw.filter(
				(
					part,
				): part is {
					type: "text" | "tool_use" | "tool_result";
					text?: string;
				} => {
					return typeof part === "object" && part !== null;
				},
			)
		: [];

	const prompt =
		getString(payload, "prompt") ??
		parts
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text ?? "")
			.join("\n");

	// If the user explicitly confirms a pending hook ask, mark it confirmed.
	// The next retry of the same tool+args will be allowed once.
	confirmAskGatePrompt(prompt);

	const sessionId =
		getString(payload, "sessionID") ?? getString(payload, "sessionId") ?? "";
	if (!sessionId) return;
	const parentSessionId = await args.resolveParentSessionId(sessionId);

	const result = await executeUserPromptSubmitHooks(
		{
			sessionId,
			parentSessionId,
			prompt,
			parts: parts as ChatMessagePart[],
			cwd: args.cwd,
		},
		args.config,
		undefined,
		args.env,
	);

	if (result.block) {
		out.error = result.reason ?? "Blocked by UserPromptSubmit hook";
	}

	if (result.messages.length > 0) {
		out.hookMessages = result.messages;
	}
}
