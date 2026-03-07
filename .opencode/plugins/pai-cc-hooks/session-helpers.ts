import type {
	SessionGetFn,
	SessionPromptAsyncFn,
	UnknownRecord,
} from "./types";

export function asRecord(value: unknown): UnknownRecord {
	return typeof value === "object" && value !== null
		? (value as UnknownRecord)
		: {};
}

export function getString(obj: UnknownRecord, key: string): string | undefined {
	const value = obj[key];
	return typeof value === "string" ? value : undefined;
}

export function getRecord(
	obj: UnknownRecord,
	key: string,
): UnknownRecord | undefined {
	const value = obj[key];
	return typeof value === "object" && value !== null
		? (value as UnknownRecord)
		: undefined;
}

export function getBoolean(
	obj: UnknownRecord,
	key: string,
): boolean | undefined {
	const value = obj[key];
	return typeof value === "boolean" ? value : undefined;
}

export function getSessionIdFromEvent(
	properties: UnknownRecord,
	info: UnknownRecord,
): string {
	return (
		getString(properties, "sessionID") ??
		getString(info, "sessionID") ??
		getString(info, "id") ??
		""
	);
}

export function getParentSessionIdFromEvent(
	properties: UnknownRecord,
	info: UnknownRecord,
): string | undefined {
	return (
		getString(info, "parentID") ??
		getString(info, "parentId") ??
		getString(properties, "parentSessionID") ??
		getString(properties, "parentSessionId")
	);
}

export function getSessionGetFromContext(ctx: unknown):
	| SessionGetFn
	| undefined {
	const context = asRecord(ctx);
	const client = asRecord(context.client);
	const session = asRecord(client.session);
	const get = session.get;
	if (typeof get !== "function") {
		return undefined;
	}

	return (args) =>
		(get as (this: unknown, args: unknown) => Promise<unknown>).call(
			session,
			args,
		);
}

export function getSessionPromptAsyncFromContext(
	ctx: unknown,
): SessionPromptAsyncFn | undefined {
	const context = asRecord(ctx);
	const client = asRecord(context.client);
	const session = asRecord(client.session);
	const promptAsync = session.promptAsync;
	if (typeof promptAsync !== "function") {
		return undefined;
	}

	return (args) =>
		(promptAsync as (this: unknown, args: unknown) => Promise<unknown>).call(
			session,
			args,
		);
}
