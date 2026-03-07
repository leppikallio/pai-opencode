export type EventHookHandler = (input: unknown) => Promise<void>;
export type HookHandler = (input: unknown, output: unknown) => Promise<void>;

export type SessionGetFn = (args: { path: { id: string } }) => Promise<unknown>;
export type SessionPromptAsyncFn = (args: {
	path: { id: string };
	body: {
		noReply: boolean;
		parts: Array<{ type: "text"; text: string; synthetic?: boolean }>;
	};
}) => Promise<unknown>;

export type UnknownRecord = Record<string, unknown>;
export type SessionLifecycleEventName = "SessionStart" | "SessionEnd";

export type SessionStartPolicy = {
	allowLoadContext: boolean;
	allowLoadContextStdoutInjection: boolean;
	allowScratchpadBindingStdoutInjection: boolean;
};

export type CmuxNotifyFn = (args: {
	sessionId: string;
	title: string;
	subtitle: string;
	body: string;
}) => Promise<void>;

export type CompletionAttentionNotifyFn = (event: {
	eventKey: "AGENT_COMPLETED";
	sessionId: string;
	reasonShort: string;
}) => Promise<void>;

export type FetchLike = (url: string, init?: RequestInit) => Promise<unknown>;
