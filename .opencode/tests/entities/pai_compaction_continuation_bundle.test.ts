import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import PaiCcHooksPlugin from "../../plugins/pai-cc-hooks";
import { __resetPaiCcHooksSettingsCacheForTests } from "../../plugins/pai-cc-hooks/hook";
import {
	PAI_COMPACTION_CONTINUATION_MAX_BYTES,
	PAI_COMPACTION_CONTINUATION_MAX_LINES,
} from "../../plugins/pai-cc-hooks/compaction/continuation-bundle";
import { applyCombinedCompactionBudget } from "../../plugins/pai-cc-hooks/compaction/precompact";
import { getCompactionIscPreservationPath } from "../../plugins/pai-cc-hooks/compaction/isc-preserver";
import {
	markBackgroundTaskCompleted,
	recordBackgroundTaskLaunch,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";
import { setCurrentWorkPathForSession } from "../../plugins/lib/paths";

type PluginHooks = Record<string, unknown>;

function lineCount(value: string): number {
	if (value.length === 0) {
		return 0;
	}

	return value.split("\n").length;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function restoreEnv(key: string, previousValue: string | undefined): void {
	if (previousValue === undefined) {
		delete process.env[key];
		return;
	}

	process.env[key] = previousValue;
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

async function seedWorkArtifacts(args: {
	root: string;
	sessionId: string;
	slug: string;
	progress: string;
	criteria: Array<{ id: string; text: string; status: string }>;
}): Promise<string> {
	const workDir = path.join(args.root, "MEMORY", "WORK", "2026-03", args.sessionId);
	await fs.mkdir(workDir, { recursive: true });

	await fs.writeFile(
		path.join(workDir, "PRD-20260310-compaction.md"),
		[
			"---",
			`task: Compaction continuity ${args.sessionId}`,
			`slug: ${args.slug}`,
			"effort: standard",
			"phase: execute",
			`progress: ${args.progress}`,
			"mode: interactive",
			"started: 2026-03-10T00:00:00.000Z",
			"updated: 2026-03-10T00:00:00.000Z",
			"---",
			"",
			"## Criteria",
		].join("\n"),
		"utf-8",
	);

	await fs.writeFile(
		path.join(workDir, "ISC.json"),
		`${JSON.stringify(
			{
				v: "0.1",
				ideal: "Preserve continuity",
				criteria: args.criteria,
				antiCriteria: [],
				updatedAt: new Date().toISOString(),
			},
			null,
			2,
		)}\n`,
		"utf-8",
	);

	await setCurrentWorkPathForSession(args.sessionId, workDir);
	return workDir;
}

async function createPluginHooks(): Promise<PluginHooks> {
	const previousDisabled = process.env.PAI_CC_HOOKS_DISABLED;
	delete process.env.PAI_CC_HOOKS_DISABLED;
	__resetPaiCcHooksSettingsCacheForTests();

	try {
		return (await PaiCcHooksPlugin({ client: {}, $: {} } as any)) as PluginHooks;
	} finally {
		restoreEnv("PAI_CC_HOOKS_DISABLED", previousDisabled);
		__resetPaiCcHooksSettingsCacheForTests();
	}
}

describe("compaction continuation bundle", () => {
	test("runtime plugin wiring registers and invokes experimental.session.compacting when flag ON", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-compaction-bundle-on-"));
		const previousRoot = process.env.OPENCODE_ROOT;
		const previousFlag = process.env.PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED;

		process.env.OPENCODE_ROOT = root;
		process.env.PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED = "1";
		try {
			const parentSessionId = "ses_compaction_parent";
			const childActiveSessionId = "ses_compaction_child_active";
			const childDoneSessionId = "ses_compaction_child_done";
			const unrelatedSessionId = "ses_compaction_unrelated";

			await seedWorkArtifacts({
				root,
				sessionId: parentSessionId,
				slug: "task-6-parent",
				progress: "2/5",
				criteria: [
					{ id: "ISC-1", text: "finished criterion", status: "VERIFIED" },
					{ id: "ISC-2", text: "next unfinished criterion", status: "PENDING" },
				],
			});

			await seedWorkArtifacts({
				root,
				sessionId: childActiveSessionId,
				slug: "task-6-child-active",
				progress: "0/1",
				criteria: [{ id: "ISC-1", text: "active child", status: "PENDING" }],
			});

			await seedWorkArtifacts({
				root,
				sessionId: childDoneSessionId,
				slug: "task-6-child-done",
				progress: "1/1",
				criteria: [{ id: "ISC-1", text: "done child", status: "VERIFIED" }],
			});

			await seedWorkArtifacts({
				root,
				sessionId: unrelatedSessionId,
				slug: "task-6-unrelated",
				progress: "0/1",
				criteria: [{ id: "ISC-1", text: "unrelated", status: "PENDING" }],
			});

			const nowMs = Date.now();
			await recordBackgroundTaskLaunch({
				taskId: "task_compaction_active",
				childSessionId: childActiveSessionId,
				parentSessionId,
				nowMs,
			});
			await recordBackgroundTaskLaunch({
				taskId: "task_compaction_done",
				childSessionId: childDoneSessionId,
				parentSessionId,
				nowMs: nowMs + 1,
			});
			await markBackgroundTaskCompleted({
				taskId: "task_compaction_done",
				nowMs: nowMs + 2,
			});

			const plugin = await createPluginHooks();
			const hook = plugin["experimental.session.compacting"];
			expect(typeof hook).toBe("function");

			const output: { context: string[] } = { context: [] };
			await (hook as (input: unknown, output: unknown) => Promise<void>)(
				{ sessionID: parentSessionId },
				output,
			);

			expect(output.context.length).toBe(1);
			const bundleSlice = output.context[0] ?? "";
			expect(bundleSlice).toContain("PAI COMPACTION CONTINUATION BUNDLE (v1)");
			expect(bundleSlice).toContain('"rule": "parent-plus-referenced-children"');
			expect(bundleSlice).toContain(parentSessionId);
			expect(bundleSlice).toContain(childActiveSessionId);
			expect(bundleSlice).not.toContain(unrelatedSessionId);
			expect(bundleSlice.split("\n").length).toBeLessThanOrEqual(
				PAI_COMPACTION_CONTINUATION_MAX_LINES,
			);
			expect(Buffer.byteLength(bundleSlice, "utf8")).toBeLessThanOrEqual(
				PAI_COMPACTION_CONTINUATION_MAX_BYTES,
			);

			const preservationPath = getCompactionIscPreservationPath();
			expect(await pathExists(preservationPath)).toBe(true);
			const preservationRaw = await fs.readFile(preservationPath, "utf-8");
			expect(preservationRaw).toContain(parentSessionId);
		} finally {
			restoreEnv("OPENCODE_ROOT", previousRoot);
			restoreEnv("PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED", previousFlag);
		}
	});

	test("flag OFF keeps continuation bundle slice disabled", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-compaction-bundle-off-"));
		const previousRoot = process.env.OPENCODE_ROOT;
		const previousFlag = process.env.PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED;

		process.env.OPENCODE_ROOT = root;
		process.env.PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED = "0";
		try {
			const parentSessionId = "ses_compaction_parent_flag_off";
			await seedWorkArtifacts({
				root,
				sessionId: parentSessionId,
				slug: "task-6-parent-flag-off",
				progress: "0/1",
				criteria: [{ id: "ISC-1", text: "criterion", status: "PENDING" }],
			});

			const plugin = await createPluginHooks();
			const hook = plugin["experimental.session.compacting"];
			expect(typeof hook).toBe("function");

			const output: { context: string[] } = { context: ["existing"] };
			await (hook as (input: unknown, output: unknown) => Promise<void>)(
				{ sessionID: parentSessionId },
				output,
			);

			expect(output.context).toEqual(["existing"]);
			expect(await pathExists(getCompactionIscPreservationPath())).toBe(false);
		} finally {
			restoreEnv("OPENCODE_ROOT", previousRoot);
			restoreEnv("PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED", previousFlag);
		}
	});

	test("flag OFF still executes configured PreCompact hook chain", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-compaction-precompact-off-"));
		const hookPath = path.join(root, "precompact-hook.sh");
		const stdinPath = path.join(root, "precompact-stdin.json");
		const previousRoot = process.env.OPENCODE_ROOT;
		const previousFlag = process.env.PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED;
		const previousConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

		process.env.OPENCODE_ROOT = root;
		process.env.PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED = "0";
		process.env.PAI_CC_HOOKS_CONFIG_ROOT = root;

		try {
			await fs.writeFile(
				hookPath,
				[
					"#!/bin/sh",
					`cat > \"${stdinPath}\"`,
					"printf '<system-reminder>Injected PreCompact Beads context</system-reminder>'",
				].join("\n"),
				"utf-8",
			);
			await fs.chmod(hookPath, 0o755);

			await writeJson(path.join(root, "settings.json"), {
				env: {
					PAI_DIR: root,
				},
				hooks: {
					PreCompact: [
						{
							hooks: [{ type: "command", command: hookPath }],
						},
					],
				},
			});

			const parentSessionId = "ses_compaction_precompact_flag_off";
			await seedWorkArtifacts({
				root,
				sessionId: parentSessionId,
				slug: "task-6-parent-precompact-flag-off",
				progress: "0/1",
				criteria: [{ id: "ISC-1", text: "criterion", status: "PENDING" }],
			});

			const plugin = await createPluginHooks();
			const hook = plugin["experimental.session.compacting"];
			expect(typeof hook).toBe("function");

			const output: { context: string[] } = { context: ["existing"] };
			await (hook as (input: unknown, output: unknown) => Promise<void>)(
				{ sessionID: parentSessionId },
				output,
			);

			expect(output.context).toEqual([
				"existing",
				"<system-reminder>Injected PreCompact Beads context</system-reminder>",
			]);
			expect(await pathExists(getCompactionIscPreservationPath())).toBe(false);

			const stdinRaw = await fs.readFile(stdinPath, "utf-8");
			const stdinPayload = JSON.parse(stdinRaw) as {
				hook_event_name?: string;
				session_id?: string;
				root_session_id?: string;
			};
			expect(stdinPayload.hook_event_name).toBe("PreCompact");
			expect(stdinPayload.session_id).toBe(parentSessionId);
			expect(stdinPayload.root_session_id).toBe(parentSessionId);
		} finally {
			restoreEnv("OPENCODE_ROOT", previousRoot);
			restoreEnv("PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED", previousFlag);
			restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", previousConfigRoot);
		}
	});

	test("combined PreCompact and continuation output stays in deterministic budget", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-compaction-precompact-budget-"));
		const hookPath = path.join(root, "precompact-large-hook.sh");
		const previousRoot = process.env.OPENCODE_ROOT;
		const previousFlag = process.env.PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED;
		const previousConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

		process.env.OPENCODE_ROOT = root;
		process.env.PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED = "1";
		process.env.PAI_CC_HOOKS_CONFIG_ROOT = root;

		try {
			await fs.writeFile(
				hookPath,
				[
					"#!/bin/sh",
					"printf 'beads:'",
					"i=0",
					"while [ \"$i\" -lt 50000 ]; do",
					"  printf 'x'",
					"  i=$((i + 1))",
					"done",
				].join("\n"),
				"utf-8",
			);
			await fs.chmod(hookPath, 0o755);

			const parentSessionId = "ses_compaction_precompact_budget";
			await seedWorkArtifacts({
				root,
				sessionId: parentSessionId,
				slug: "task-6-parent-precompact-budget",
				progress: "0/2",
				criteria: [
					{ id: "ISC-1", text: "first criterion", status: "PENDING" },
					{ id: "ISC-2", text: "second criterion", status: "PENDING" },
				],
			});

			await writeJson(path.join(root, "settings.json"), {
				env: {
					PAI_DIR: root,
				},
				hooks: {},
			});

			const baselinePlugin = await createPluginHooks();
			const baselineHook = baselinePlugin["experimental.session.compacting"];
			expect(typeof baselineHook).toBe("function");

			const baselineOutput: { context: string[] } = { context: [] };
			await (baselineHook as (input: unknown, output: unknown) => Promise<void>)(
				{ sessionID: parentSessionId },
				baselineOutput,
			);
			expect(baselineOutput.context).toHaveLength(1);
			const baselineContinuation = baselineOutput.context[0] ?? "";

			await writeJson(path.join(root, "settings.json"), {
				env: {
					PAI_DIR: root,
				},
				hooks: {
					PreCompact: [
						{
							hooks: [{ type: "command", command: hookPath }],
						},
					],
				},
			});

			const plugin = await createPluginHooks();
			const hook = plugin["experimental.session.compacting"];
			expect(typeof hook).toBe("function");

			const output: { context: string[] } = { context: [] };
			await (hook as (input: unknown, output: unknown) => Promise<void>)(
				{ sessionID: parentSessionId },
				output,
			);

			expect(output.context).toHaveLength(2);
			const beadsSlice = output.context[0] ?? "";
			const continuationSlice = output.context[1] ?? "";
			expect(beadsSlice).toContain("[beads] output truncated");
			const normalizeGeneratedAt = (value: string) =>
				value.replace(/"generatedAt":\s*"[^"]+"/, '"generatedAt": "<dynamic>"');
			expect(normalizeGeneratedAt(continuationSlice)).toBe(
				normalizeGeneratedAt(baselineContinuation),
			);

			const combined = output.context.join("\n");
			expect(lineCount(combined)).toBeLessThanOrEqual(
				PAI_COMPACTION_CONTINUATION_MAX_LINES,
			);
			expect(Buffer.byteLength(combined, "utf8")).toBeLessThanOrEqual(
				PAI_COMPACTION_CONTINUATION_MAX_BYTES,
			);
		} finally {
			restoreEnv("OPENCODE_ROOT", previousRoot);
			restoreEnv("PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED", previousFlag);
			restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", previousConfigRoot);
		}
	});

	test("combined budget truncates beads first, then continuation with existing marker", () => {
		const beadsContext = `beads:${"x".repeat(8000)}`;
		const continuationContext = Array.from(
			{ length: 120 },
			(_, index) => `continuation line ${index} ${"y".repeat(80)}`,
		).join("\n");

		const bounded = applyCombinedCompactionBudget({
			beadsContext,
			continuationContext,
			maxLines: 40,
			maxBytes: 5000,
		});

		expect(bounded.beadsContext).toBeDefined();
		expect(bounded.beadsContext).toContain("[beads] output truncated");
		expect(bounded.continuationContext).toBeDefined();
		expect(bounded.continuationContext).toContain("[truncated to");

		const slices = [bounded.beadsContext, bounded.continuationContext].filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		);
		const combined = slices.join("\n");
		expect(lineCount(combined)).toBeLessThanOrEqual(40);
		expect(Buffer.byteLength(combined, "utf8")).toBeLessThanOrEqual(5000);
	});

	test("combined budget keeps one extra continuation line when boundary newline already exists", () => {
		const beadsContext = "[beads] output truncated";
		const continuationContext = ["", "line 1", "line 2", "line 3", "line 4", "line 5"].join(
			"\n",
		);

		const bounded = applyCombinedCompactionBudget({
			beadsContext,
			continuationContext,
			maxLines: 6,
			maxBytes: 10_000,
		});

		expect(bounded.beadsContext).toBe(beadsContext);
		expect(bounded.continuationContext).toBeDefined();
		expect(bounded.continuationContext).toContain("line 3");
		expect(bounded.continuationContext).toContain("[truncated to 5 lines]");

		const slices = [bounded.beadsContext, bounded.continuationContext].filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		);
		const combined = slices.join("\n");
		expect(lineCount(combined)).toBeLessThanOrEqual(6);
		expect(Buffer.byteLength(combined, "utf8")).toBeLessThanOrEqual(10_000);
	});

	test("combined budget does not over-truncate beads when continuation starts with newline", () => {
		const beadsContext = ["beads line 1", "beads line 2", "beads line 3"].join("\n");
		const continuationContext = ["", "continuation line 1", "continuation line 2"].join("\n");

		const bounded = applyCombinedCompactionBudget({
			beadsContext,
			continuationContext,
			maxLines: 5,
			maxBytes: 10_000,
		});

		expect(bounded.beadsContext).toContain("beads line 1");
		expect(bounded.beadsContext).toContain("[beads] output truncated");
		expect(bounded.continuationContext).toBe(continuationContext);

		const slices = [bounded.beadsContext, bounded.continuationContext].filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		);
		const combined = slices.join("\n");
		expect(lineCount(combined)).toBeLessThanOrEqual(5);
		expect(Buffer.byteLength(combined, "utf8")).toBeLessThanOrEqual(10_000);
	});

	test("combined budget final output always respects extremely small byte budgets", () => {
		const bounded = applyCombinedCompactionBudget({
			beadsContext: "beads context that will need truncation",
			continuationContext: "continuation",
			maxLines: 1,
			maxBytes: 8,
		});

		const slices = [bounded.beadsContext, bounded.continuationContext].filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		);
		const combined = slices.join("\n");
		expect(lineCount(combined)).toBeLessThanOrEqual(1);
		expect(Buffer.byteLength(combined, "utf8")).toBeLessThanOrEqual(8);
	});

	test("combined budget returns empty output when no line or byte budget remains", () => {
		const bounded = applyCombinedCompactionBudget({
			beadsContext: "beads",
			continuationContext: "continuation",
			maxLines: 0,
			maxBytes: 0,
		});

		expect(bounded).toEqual({
			beadsContext: undefined,
			continuationContext: undefined,
		});
	});
});
