import {
	isPlainObject,
	parseJsonSafe,
	type ToolWithExecute,
} from "./lifecycle_lib";

export type WatchdogJsonOk = {
	ok: true;
	timed_out: boolean;
	stage?: string;
	elapsed_s?: number;
	timeout_s?: number;
	checkpoint_path?: string;
};

export type WatchdogJsonFailure = {
	ok: false;
	code: string;
	message: string;
	details: Record<string, unknown>;
};

export type WatchdogJsonResult = WatchdogJsonOk | WatchdogJsonFailure;

export async function executeWatchdogJson(args: {
	watchdogTool: ToolWithExecute;
	payload: Record<string, unknown>;
	tool_context?: unknown;
}): Promise<WatchdogJsonResult> {
	let raw: unknown;
	try {
		raw = await args.watchdogTool.execute(args.payload, args.tool_context);
	} catch (e) {
		return {
			ok: false,
			code: "WATCHDOG_FAILED",
			message: "watchdog_check execution threw",
			details: { message: String(e) },
		};
	}

	if (typeof raw !== "string") {
		return {
			ok: false,
			code: "WATCHDOG_FAILED",
			message: "watchdog_check returned non-string response",
			details: { response_type: typeof raw },
		};
	}

	const parsed = parseJsonSafe(raw);
	if (!parsed.ok || !isPlainObject(parsed.value)) {
		return {
			ok: false,
			code: "WATCHDOG_FAILED",
			message: "watchdog_check returned non-JSON response",
			details: { raw },
		};
	}

	const envelope = parsed.value as Record<string, unknown>;
	if (envelope.ok === true) {
		return {
			ok: true,
			timed_out: envelope.timed_out === true,
			stage: typeof envelope.stage === "string" ? envelope.stage : undefined,
			elapsed_s:
				typeof envelope.elapsed_s === "number" ? envelope.elapsed_s : undefined,
			timeout_s:
				typeof envelope.timeout_s === "number" ? envelope.timeout_s : undefined,
			checkpoint_path:
				typeof envelope.checkpoint_path === "string"
					? envelope.checkpoint_path
					: undefined,
		};
	}

	const upstreamError = isPlainObject(envelope.error)
		? (envelope.error as Record<string, unknown>)
		: null;
	const upstreamDetails = isPlainObject(upstreamError?.details)
		? (upstreamError?.details as Record<string, unknown>)
		: {};

	return {
		ok: false,
		code: String(upstreamError?.code ?? "WATCHDOG_FAILED"),
		message: String(upstreamError?.message ?? "watchdog_check failed"),
		details: upstreamDetails,
	};
}
