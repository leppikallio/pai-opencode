import fs from "node:fs";
import path from "node:path";

import {
	PAI_COMPACTION_CONTINUATION_BUNDLE_SCHEMA,
	type PaiCompactionBackgroundTaskHint,
	type PaiCompactionContinuationBundleV1,
	type PaiCompactionIscCriterionHint,
	type PaiCompactionIscProgressSummary,
	type PaiCompactionLineageItem,
} from "../../adapters/types";
import { getCurrentWorkPathForSession } from "../../lib/paths";
import {
	isBackgroundTaskActive,
	normalizeBackgroundTaskLifecycle,
} from "../background/lifecycle-normalizer";
import {
	listBackgroundTasksByParent,
	type BackgroundTaskRecord,
} from "../tools/background-task-state";

const PRD_FILE_RE = /^PRD(?:-.*)?\.md$/i;

export const PAI_COMPACTION_CONTINUATION_MAX_LINES = 80;
export const PAI_COMPACTION_CONTINUATION_MAX_BYTES = 12_000;

const MAX_HINTS = 6;
const MAX_NEXT_UNFINISHED_ISC = 5;
const MAX_ACTIVE_CHILD_SESSIONS = 8;
const MAX_LINEAGE_ITEMS = 12;
const MAX_SESSION_POINTERS = 16;
const MAX_HINT_TEXT = 160;

type PrdSummary = {
	slug?: string;
	progress?: string;
	phase?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizeSessionId(sessionIdRaw: string): string {
	const trimmed = sessionIdRaw.trim();
	if (!trimmed) return "";
	if (trimmed.length > 128) return "";
	if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return "";
	return trimmed;
}

function optionalTrimmed(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function uniqueStrings(values: readonly string[], maxItems: number): string[] {
	const out: string[] = [];
	const seen = new Set<string>();

	for (const raw of values) {
		const normalized = raw.trim();
		if (!normalized || seen.has(normalized)) {
			continue;
		}

		seen.add(normalized);
		out.push(normalized);
		if (out.length >= maxItems) {
			break;
		}
	}

	return out;
}

function trimHintText(value: string, maxLength = MAX_HINT_TEXT): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeIscStatus(statusRaw: unknown): string {
	if (typeof statusRaw !== "string") {
		return "PENDING";
	}

	const upper = statusRaw.trim().toUpperCase();
	if (!upper) return "PENDING";
	if (upper.includes("VERIFIED") || upper.includes("DONE")) return "VERIFIED";
	if (upper.includes("FAILED")) return "FAILED";
	if (upper.includes("REMOVED")) return "REMOVED";
	if (upper.includes("IN_PROGRESS") || upper.includes("IN-PROGRESS")) {
		return "IN_PROGRESS";
	}

	if (upper.includes("PENDING")) {
		return "PENDING";
	}

	return upper;
}

function parseFrontmatter(content: string): Record<string, string> {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!frontmatterMatch) {
		return {};
	}

	const body = frontmatterMatch[1] ?? "";
	const out: Record<string, string> = {};
	for (const line of body.split(/\r?\n/)) {
		const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
		if (!match) {
			continue;
		}

		const key = (match[1] ?? "").trim().toLowerCase();
		const value = (match[2] ?? "").trim().replace(/^['"]|['"]$/g, "");
		if (!key || !value) {
			continue;
		}

		out[key] = value;
	}

	return out;
}

async function readPrdSummary(workDir: string): Promise<PrdSummary> {
	let entries: fs.Dirent[] = [];
	try {
		entries = await fs.promises.readdir(workDir, { withFileTypes: true });
	} catch {
		return {};
	}

	const candidates = entries
		.filter((entry) => entry.isFile() && PRD_FILE_RE.test(entry.name))
		.map((entry) => path.join(workDir, entry.name));

	if (candidates.length === 0) {
		return {};
	}

	const scored = await Promise.all(
		candidates.map(async (prdPath) => {
			let mtimeMs = 0;
			try {
				const stat = await fs.promises.stat(prdPath);
				mtimeMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
			} catch {
				mtimeMs = 0;
			}

			const base = path.basename(prdPath).toLowerCase();
			const canonicalScore = base === "prd.md" ? 2 : base.startsWith("prd-") ? 1 : 0;

			return {
				prdPath,
				mtimeMs,
				canonicalScore,
			};
		}),
	);

	scored.sort((left, right) => {
		if (right.canonicalScore !== left.canonicalScore) {
			return right.canonicalScore - left.canonicalScore;
		}

		if (right.mtimeMs !== left.mtimeMs) {
			return right.mtimeMs - left.mtimeMs;
		}

		return left.prdPath.localeCompare(right.prdPath);
	});

	const candidate = scored[0]?.prdPath;
	if (!candidate) {
		return {};
	}

	try {
		const content = await fs.promises.readFile(candidate, "utf-8");
		const frontmatter = parseFrontmatter(content);
		return {
			slug: optionalTrimmed(frontmatter.slug),
			progress: optionalTrimmed(frontmatter.progress),
			phase: optionalTrimmed(frontmatter.phase),
		};
	} catch {
		return {};
	}
}

function emptyIscSummary(): PaiCompactionIscProgressSummary {
	return {
		total: 0,
		verified: 0,
		pending: 0,
		failed: 0,
		nextUnfinished: [],
	};
}

async function readIscSummary(workDir: string): Promise<PaiCompactionIscProgressSummary> {
	const iscPath = path.join(workDir, "ISC.json");
	let raw: string;
	try {
		raw = await fs.promises.readFile(iscPath, "utf-8");
	} catch {
		return emptyIscSummary();
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return emptyIscSummary();
	}

	if (!isRecord(parsed)) {
		return emptyIscSummary();
	}

	const criteriaRaw = parsed.criteria;
	if (!Array.isArray(criteriaRaw)) {
		return emptyIscSummary();
	}

	let verified = 0;
	let pending = 0;
	let failed = 0;
	const nextUnfinished: PaiCompactionIscCriterionHint[] = [];

	for (const criterion of criteriaRaw) {
		if (!isRecord(criterion)) {
			continue;
		}

		const id = optionalTrimmed(criterion.id);
		const text = optionalTrimmed(criterion.text);
		if (!id || !text) {
			continue;
		}

		const status = normalizeIscStatus(criterion.status);
		if (status === "VERIFIED") {
			verified += 1;
			continue;
		}

		if (status === "REMOVED") {
			continue;
		}

		if (status === "FAILED") {
			failed += 1;
		}

		pending += 1;
		if (nextUnfinished.length < MAX_NEXT_UNFINISHED_ISC) {
			nextUnfinished.push({
				id,
				text,
				status,
			});
		}
	}

	return {
		total: verified + pending,
		verified,
		pending,
		failed,
		nextUnfinished,
	};
}

function buildLineageSummary(
	tasks: readonly BackgroundTaskRecord[],
): PaiCompactionContinuationBundleV1["background"]["lineage"] {
	const statusCounts: Record<string, number> = {};
	for (const task of tasks) {
		const lifecycle = normalizeBackgroundTaskLifecycle(task);
		statusCounts[lifecycle.status] = (statusCounts[lifecycle.status] ?? 0) + 1;
	}

	const activeDelegated = tasks.filter((task) =>
		isBackgroundTaskActive(task),
	).length;

	const recent: PaiCompactionLineageItem[] = [...tasks]
		.sort((left, right) => right.launched_at_ms - left.launched_at_ms)
		.slice(0, MAX_LINEAGE_ITEMS)
		.map((task) => {
			const lifecycle = normalizeBackgroundTaskLifecycle(task);
			return {
				taskId: task.task_id,
				childSessionId: task.child_session_id,
				status: lifecycle.status,
				launchedAtMs: task.launched_at_ms,
				updatedAtMs: task.updated_at_ms,
			};
		});

	return {
		totalDelegated: tasks.length,
		activeDelegated,
		terminalDelegated: Math.max(0, tasks.length - activeDelegated),
		statusCounts,
		recent,
	};
}

function buildActiveChildSessionHints(
	tasks: readonly BackgroundTaskRecord[],
): PaiCompactionBackgroundTaskHint[] {
	const out: PaiCompactionBackgroundTaskHint[] = [];
	const seenChildSessionIds = new Set<string>();

	for (const task of tasks) {
		if (!isBackgroundTaskActive(task)) {
			continue;
		}

		if (seenChildSessionIds.has(task.child_session_id)) {
			continue;
		}

		seenChildSessionIds.add(task.child_session_id);
		const lifecycle = normalizeBackgroundTaskLifecycle(task);
		out.push({
			taskId: task.task_id,
			childSessionId: task.child_session_id,
			status: lifecycle.status,
			taskDescription: optionalTrimmed(task.task_description),
		});

		if (out.length >= MAX_ACTIVE_CHILD_SESSIONS) {
			break;
		}
	}

	return out;
}

function buildContinuationHints(args: {
	isc: PaiCompactionIscProgressSummary;
	activeChildren: readonly PaiCompactionBackgroundTaskHint[];
	pendingTaskIds: readonly string[];
	statusCounts: Record<string, number>;
	currentPointer?: string;
}): string[] {
	const hints: string[] = [];

	const topIsc = args.isc.nextUnfinished[0];
	if (topIsc) {
		hints.push(trimHintText(`Resume ${topIsc.id}: ${topIsc.text}`));
	}

	if (args.pendingTaskIds.length > 0) {
		hints.push(
			trimHintText(
				`Check ${args.pendingTaskIds.length} active delegated task(s): ${args.pendingTaskIds.join(
					", ",
				)}.`,
			),
		);
	}

	if ((args.statusCounts.failed ?? 0) > 0 || (args.statusCounts.stale ?? 0) > 0) {
		hints.push(
			trimHintText(
				`Review delegated failures/stale tasks (failed=${args.statusCounts.failed ?? 0}, stale=${args.statusCounts.stale ?? 0}).`,
			),
		);
	}

	if (!args.currentPointer) {
		hints.push("Reconcile current-work pointer before continuing execution.");
	}

	if (args.activeChildren.length === 0 && args.isc.pending > 0) {
		hints.push("Continue parent execution with the next unfinished ISC criterion.");
	}

	if (hints.length === 0) {
		hints.push("Continue from current work context and verify remaining criteria.");
	}

	return uniqueStrings(hints, MAX_HINTS);
}

export function applyCompactionContinuationSerializationBudget(args: {
	text: string;
	maxLines: number;
	maxBytes: number;
}): string {
	let lines = args.text.split("\n");
	if (lines.length > args.maxLines) {
		lines = lines.slice(0, Math.max(1, args.maxLines - 1));
		lines.push(`…[truncated to ${args.maxLines} lines]`);
	}

	let output = lines.join("\n");
	const byteNotice = `\n…[truncated to ${args.maxBytes} bytes]`;

	while (Buffer.byteLength(output, "utf8") > args.maxBytes && lines.length > 1) {
		lines = lines.slice(0, -1);
		output = lines.join("\n");
	}

	if (Buffer.byteLength(output, "utf8") <= args.maxBytes) {
		return output;
	}

	let trimmed = output;
	while (
		trimmed.length > 0 &&
		Buffer.byteLength(`${trimmed}${byteNotice}`, "utf8") > args.maxBytes
	) {
		trimmed = trimmed.slice(0, -1);
	}

	return `${trimmed}${byteNotice}`;
}

export async function buildCompactionContinuationBundle(args: {
	parentSessionId: string;
	now?: Date;
}): Promise<PaiCompactionContinuationBundleV1> {
	const parentSessionId = normalizeSessionId(args.parentSessionId);
	const generatedAt = (args.now ?? new Date()).toISOString();

	const tasks = parentSessionId
		? await listBackgroundTasksByParent({ parentSessionId })
		: [];

	const referencedChildSessionIds = uniqueStrings(
		tasks.map((task) => task.child_session_id),
		MAX_SESSION_POINTERS - 1,
	);
	const includedSessionIds = uniqueStrings(
		[parentSessionId, ...referencedChildSessionIds].filter((item) => item.length > 0),
		MAX_SESSION_POINTERS,
	);

	const pointers: PaiCompactionContinuationBundleV1["currentWork"]["pointers"] = [];
	for (const sessionId of includedSessionIds) {
		const workPath = await getCurrentWorkPathForSession(sessionId);
		if (!workPath) {
			continue;
		}

		pointers.push({
			sessionId,
			workDir: workPath,
			isParent: sessionId === parentSessionId,
		});
	}

	const parentPointer = pointers.find((pointer) => pointer.isParent);
	const currentPointer = parentPointer?.workDir;

	const prdSummary = currentPointer ? await readPrdSummary(currentPointer) : {};
	const iscSummary = currentPointer
		? await readIscSummary(currentPointer)
		: emptyIscSummary();

	const lineage = buildLineageSummary(tasks);
	const activeChildSessions = buildActiveChildSessionHints(tasks);
	const pendingTaskIds = uniqueStrings(
		activeChildSessions.map((task) => task.taskId),
		MAX_LINEAGE_ITEMS,
	);

	const continuationHints = buildContinuationHints({
		isc: iscSummary,
		activeChildren: activeChildSessions,
		pendingTaskIds,
		statusCounts: lineage.statusCounts,
		currentPointer,
	});

	return {
		schema: PAI_COMPACTION_CONTINUATION_BUNDLE_SCHEMA,
		generatedAt,
		selection: {
			parentSessionId,
			referencedChildSessionIds,
			includedSessionIds,
			rule: "parent-plus-referenced-children",
		},
		currentWork: {
			activeSlug: optionalTrimmed(prdSummary.slug),
			currentPointer,
			pointers,
		},
		progress: {
			prdProgress: optionalTrimmed(prdSummary.progress),
			prdPhase: optionalTrimmed(prdSummary.phase),
			isc: iscSummary,
		},
		background: {
			activeChildSessions,
			pendingTaskIds,
			lineage,
		},
		continuationHints,
		budgets: {
			maxBytes: PAI_COMPACTION_CONTINUATION_MAX_BYTES,
			maxLines: PAI_COMPACTION_CONTINUATION_MAX_LINES,
		},
	};
}

export function renderCompactionContinuationContext(
	bundle: PaiCompactionContinuationBundleV1,
): string {
	const payload = JSON.stringify(bundle, null, 2);
	const context = [
		"PAI COMPACTION CONTINUATION BUNDLE (v1)",
		`schema: ${bundle.schema}`,
		`selection_rule: ${bundle.selection.rule}`,
		`line_budget: ${bundle.budgets.maxLines}`,
		`byte_budget: ${bundle.budgets.maxBytes}`,
		"```json",
		payload,
		"```",
	].join("\n");

	return applyCompactionContinuationSerializationBudget({
		text: context,
		maxLines: bundle.budgets.maxLines,
		maxBytes: bundle.budgets.maxBytes,
	});
}

export function injectCompactionContinuationContext(args: {
	output: unknown;
	bundle: PaiCompactionContinuationBundleV1;
}): boolean {
	if (!isRecord(args.output)) {
		return false;
	}

	const rendered = renderCompactionContinuationContext(args.bundle);
	if (!rendered.trim()) {
		return false;
	}

	const outputRecord = args.output;
	if (Array.isArray(outputRecord.context)) {
		(outputRecord.context as unknown[]).push(rendered);
		return true;
	}

	outputRecord.context = [rendered];
	return true;
}
