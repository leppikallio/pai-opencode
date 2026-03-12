export const task5TouchedRoutingDocAllowlist = [
	[".opencode", "skills", "agents", "AgentPersonalities.md"],
	[".opencode", "skills", "agents", "Tools", "AgentProfileLoader.ts"],
	[".opencode", "skills", "PAI", "Tools", "PromptClassifier.help.md"],
	[".opencode", "skills", "PAI", "SYSTEM", "MEMORYSYSTEM.md"],
] as const;

export const task5TouchedRoutingSurfaceAllowlist = [
	[".opencode", "plugins", "handlers", "agent-capture.ts"],
	...task5TouchedRoutingDocAllowlist,
] as const;

export const task5RoutingForbiddenTokenPolicy = {
	literals: [
		"general-purpose",
		"does not expose a background execution flag",
		"(no background flag)",
	],
	basePatterns: [
		/Explore\s*->\s*Intern/i,
		/Task\s*\([\s\S]{0,160}?model\s*[:=]/,
	],
	markdownTablePattern: /\|\s*`Explore`\s*\|\s*`Intern`\s*\|/,
} as const;
