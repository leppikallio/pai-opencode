import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

type ForegroundGuardInput = {
	subagent_type?: string;
	prompt?: string;
	bypassAgentCheck?: boolean;
};

const OPENCODE_ROOT = resolve(import.meta.dir, "../../..");
const AGENTS_DIR = resolve(OPENCODE_ROOT, "agents");
const AGENT_SKILL_PATH = resolve(OPENCODE_ROOT, "skills", "agents", "SKILL.md");
const AGENT_CONTEXTS_DIR = resolve(
	OPENCODE_ROOT,
	"skills",
	"agents",
);

const BASE_ROUTING_AGENT_MENTIONS = [
	"general",
	"agent",
	"explore",
	"researcher",
];

let cachedRoutingAgentMentions: Set<string> | null = null;

const ROUTING_ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const EXPLICIT_BACKGROUND_PATTERNS = [
	/\brun[_\s-]?in[_\s-]?background\s*:?\s*true\b/i,
	/\bplanner[-\s]?designated\s+for\s+background\b/i,
];

const EXPLICIT_LONG_RUNNING_OR_FAN_OUT_PATTERNS = [
	/\blong[-\s]?running\b/i,
	/\bfan[-\s]?out\b/i,
	/\b(parallel|concurrent)\b[\s\S]{0,40}\b(sub-?agents?|agents?|tasks?|workers?)\b/i,
	/\b(spawn|launch|delegate)\b[\s\S]{0,40}\b(\d+|multiple|many|several)\b[\s\S]{0,40}\b(sub-?agents?|agents?|tasks?|workers?)\b/i,
];

function isLikelyFileReferenceMention(prompt: string, mentionStart: number, mention: string): boolean {
	const referenceSuffix = prompt.slice(mentionStart + 1 + mention.length);
	if (!referenceSuffix) {
		return false;
	}

	if (referenceSuffix.startsWith("/")) {
		return true;
	}

	if (/^\.[A-Za-z0-9_./~-]/.test(referenceSuffix)) {
		return true;
	}

	return false;
}

function extractAgentMentions(prompt: string): string[] {
	const mentions: string[] = [];
	const mentionPattern = /(^|[\s(])@([A-Za-z][A-Za-z0-9_-]*)\b/g;

	for (const match of prompt.matchAll(mentionPattern)) {
		const mentionStart = (match.index ?? 0) + (match[1] ?? "").length;
		const mention = (match[2] ?? "").trim().toLowerCase();
		if (isLikelyFileReferenceMention(prompt, mentionStart, mention)) {
			continue;
		}

		if (mention) {
			mentions.push(mention);
		}
	}

	return mentions;
}

function normalizeRoutingMention(value: string): string {
	return value.trim().toLowerCase();
}

function addRoutingMention(target: Set<string>, value: string): void {
	const trimmed = value.trim();
	if (!trimmed || !ROUTING_ALIAS_PATTERN.test(trimmed)) {
		return;
	}

	const normalized = normalizeRoutingMention(trimmed);
	if (!normalized) {
		return;
	}

	target.add(normalized);
}

function readTextFileSafe(filePath: string): string {
	try {
		return readFileSync(filePath, "utf-8");
	} catch {
		return "";
	}
}

function collectMentionsFromAgentRoster(target: Set<string>): void {
	try {
		const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
				continue;
			}

			addRoutingMention(target, basename(entry.name, ".md"));
		}
	} catch {
		// Best-effort discovery: missing roster should not break routing guard.
	}
}

function collectMentionsFromAgentSkill(target: Set<string>): void {
	const skillText = readTextFileSafe(AGENT_SKILL_PATH);
	if (!skillText) {
		return;
	}

	for (const match of skillText.matchAll(/"use\s+([A-Za-z][A-Za-z0-9_-]*)/gi)) {
		const alias = match[1] ?? "";
		if (alias) {
			addRoutingMention(target, alias);
		}
	}

	for (const line of skillText.split(/\r?\n/)) {
		if (!line.toLowerCase().includes("named agents")) {
			continue;
		}

		for (const group of line.matchAll(/\(([^)]+)\)/g)) {
			const aliases = group[1] ?? "";
			for (const alias of aliases.split(",")) {
				addRoutingMention(target, alias);
			}
		}
	}
}

function parseCharacterAliases(characterSpec: string): string[] {
	const aliases = new Set<string>();
	const identitySegment = characterSpec.split(/\s+-\s+/, 1)[0]?.trim() ?? "";
	if (!identitySegment) {
		return [];
	}

	for (const match of identitySegment.matchAll(/\(([^)]+)\)/g)) {
		for (const rawAlias of (match[1] ?? "").split(/[\/,]/)) {
			const alias = rawAlias.trim();
			if (alias) {
				aliases.add(alias);
			}
		}
	}

	const primarySegment = identitySegment.replace(/\([^)]*\)/g, "").trim();
	if (primarySegment) {
		const primaryAlias = primarySegment.split(/\s+/, 1)[0] ?? "";
		if (primaryAlias) {
			aliases.add(primaryAlias);
		}
	}

	return [...aliases];
}

function collectMentionsFromAgentContexts(target: Set<string>): void {
	try {
		const entries = readdirSync(AGENT_CONTEXTS_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith("Context.md")) {
				continue;
			}

			const contextText = readTextFileSafe(resolve(AGENT_CONTEXTS_DIR, entry.name));
			if (!contextText) {
				continue;
			}

			for (const match of contextText.matchAll(/\*\*Character\*\*:\s*([^\r\n]+)/g)) {
				for (const alias of parseCharacterAliases(match[1] ?? "")) {
					addRoutingMention(target, alias);
				}
			}
		}
	} catch {
		// Best-effort discovery: missing contexts should not break routing guard.
	}
}

function getKnownRoutingAgentMentions(): Set<string> {
	if (cachedRoutingAgentMentions) {
		return cachedRoutingAgentMentions;
	}

	const mentions = new Set<string>();
	for (const mention of BASE_ROUTING_AGENT_MENTIONS) {
		addRoutingMention(mentions, mention);
	}

	collectMentionsFromAgentRoster(mentions);
	collectMentionsFromAgentSkill(mentions);
	collectMentionsFromAgentContexts(mentions);

	cachedRoutingAgentMentions = mentions;
	return mentions;
}

function hasExplicitBackgroundRequest(prompt: string): boolean {
	return EXPLICIT_BACKGROUND_PATTERNS.some((pattern) => pattern.test(prompt));
}

function hasExplicitLongRunningOrFanOutRequest(prompt: string): boolean {
	return EXPLICIT_LONG_RUNNING_OR_FAN_OUT_PATTERNS.some((pattern) =>
		pattern.test(prompt),
	);
}

export function hasExplicitRoutingMention(input: ForegroundGuardInput): boolean {
	const prompt = input.prompt ?? "";
	const mentions = extractAgentMentions(prompt);
	if (mentions.length === 0) {
		return false;
	}

	const knownMentions = getKnownRoutingAgentMentions();
	return mentions.some((mention) => knownMentions.has(mention));
}

export function shouldAskForForegroundTask(input: ForegroundGuardInput): boolean {
	const agent = (input.subagent_type ?? "").toLowerCase();
	const prompt = input.prompt ?? "";

	if (input.bypassAgentCheck === true) return false;
	if (hasExplicitRoutingMention(input)) return false;
	if (agent === "explore") return false;

	if (hasExplicitBackgroundRequest(prompt)) return true;
	if (hasExplicitLongRunningOrFanOutRequest(prompt)) return true;

	return false;
}
