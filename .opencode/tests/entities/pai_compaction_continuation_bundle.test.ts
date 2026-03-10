import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import PaiCcHooksPlugin from "../../plugins/pai-cc-hooks";
import {
	PAI_COMPACTION_CONTINUATION_MAX_BYTES,
	PAI_COMPACTION_CONTINUATION_MAX_LINES,
} from "../../plugins/pai-cc-hooks/compaction/continuation-bundle";
import { getCompactionIscPreservationPath } from "../../plugins/pai-cc-hooks/compaction/isc-preserver";
import {
	markBackgroundTaskCompleted,
	recordBackgroundTaskLaunch,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";
import { setCurrentWorkPathForSession } from "../../plugins/lib/paths";

type PluginHooks = Record<string, unknown>;

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

	try {
		return (await PaiCcHooksPlugin({ client: {}, $: {} } as any)) as PluginHooks;
	} finally {
		restoreEnv("PAI_CC_HOOKS_DISABLED", previousDisabled);
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
});
