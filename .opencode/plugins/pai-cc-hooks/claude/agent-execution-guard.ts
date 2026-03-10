type ForegroundGuardInput = {
	subagent_type?: string;
	prompt?: string;
	bypassAgentCheck?: boolean;
};

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

export function hasExplicitRoutingMention(input: ForegroundGuardInput): boolean {
	const prompt = input.prompt ?? "";
	const mentions = extractAgentMentions(prompt);
	if (mentions.length === 0) {
		return false;
	}

	const normalizedSubagent = (input.subagent_type ?? "").trim().toLowerCase();
	if (normalizedSubagent && mentions.includes(normalizedSubagent)) {
		return true;
	}

	return mentions.includes("general") || mentions.includes("agent");
}

export function shouldAskForForegroundTask(input: ForegroundGuardInput): boolean {
	const agent = (input.subagent_type ?? "").toLowerCase();
	const prompt = input.prompt ?? "";

	if (input.bypassAgentCheck === true) return false;
	if (hasExplicitRoutingMention(input)) return false;
	if (agent === "explore") return false;
	if (prompt.includes("Timing: FAST")) return false;
	if (prompt.includes("Timing: STANDARD") || prompt.includes("Timing: DEEP"))
		return true;
	if (prompt.length > 800) return true;
	if (/\b(run tests|build|implement|refactor|debug|investigate)\b/i.test(prompt))
		return true;
	return false;
}
