import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
	clearDerivedContinuityStateForSession,
	getDerivedContinuityStateForSession,
} from "../../plugins/handlers/work-tracker";
import {
	createPaiClaudeHooks,
	__resetPaiCcHooksSettingsCacheForTests,
} from "../../plugins/pai-cc-hooks/hook";
import { readCompactionDerivedStateForTests } from "../../plugins/pai-cc-hooks/compaction/isc-preserver";
import { setCurrentWorkPathForSession } from "../../plugins/lib/paths";

function restoreEnv(key: string, previousValue: string | undefined): void {
	if (previousValue === undefined) {
		delete process.env[key];
		return;
	}

	process.env[key] = previousValue;
}

async function seedParentArtifacts(args: {
	root: string;
	sessionId: string;
}): Promise<{ workDir: string; prdPath: string; iscPath: string }> {
	const workDir = path.join(args.root, "MEMORY", "WORK", "2026-03", args.sessionId);
	await fs.mkdir(workDir, { recursive: true });

	const prdPath = path.join(workDir, "PRD-20260310-preservation.md");
	const iscPath = path.join(workDir, "ISC.json");

	await fs.writeFile(
		prdPath,
		[
			"---",
			"task: Preserve continuity",
			"slug: compaction-preservation",
			"effort: standard",
			"phase: execute",
			"progress: 1/3",
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
		iscPath,
		`${JSON.stringify(
			{
				v: "0.1",
				ideal: "Keep continuity",
				criteria: [
					{ id: "ISC-1", text: "completed criterion", status: "VERIFIED" },
					{ id: "ISC-2", text: "pending criterion", status: "PENDING" },
				],
				antiCriteria: [],
				updatedAt: new Date().toISOString(),
			},
			null,
			2,
		)}\n`,
		"utf-8",
	);

	await setCurrentWorkPathForSession(args.sessionId, workDir);

	return { workDir, prdPath, iscPath };
}

describe("compaction ISC/todo derived continuity preservation", () => {
	test("snapshots on compaction and restores derived state on next parent turn without mutating PRD/ISC", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-compaction-isc-"));
		const previousRoot = process.env.OPENCODE_ROOT;
		const previousFlag = process.env.PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED;
		const previousConfigRoot = process.env.PAI_CC_HOOKS_CONFIG_ROOT;

		process.env.OPENCODE_ROOT = root;
		process.env.PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED = "1";
		process.env.PAI_CC_HOOKS_CONFIG_ROOT = root;
		await fs.writeFile(path.join(root, "settings.json"), "{}\n", "utf-8");
		__resetPaiCcHooksSettingsCacheForTests();
		try {
			const parentSessionId = "ses_compaction_restore_parent";
			const { prdPath, iscPath } = await seedParentArtifacts({
				root,
				sessionId: parentSessionId,
			});

			const hooks = createPaiClaudeHooks({ ctx: {} });
			const compacting = hooks["experimental.session.compacting"];
			const chatMessage = hooks["chat.message"];

			await compacting(
				{ sessionID: parentSessionId },
				{ context: [] },
			);

			const derivedAfterSnapshot = getDerivedContinuityStateForSession(parentSessionId);
			expect(derivedAfterSnapshot).not.toBeNull();
			expect(derivedAfterSnapshot?.nextUnfinishedIscIds).toContain("ISC-2");

			const prdBeforeRestore = await fs.readFile(prdPath, "utf-8");
			const iscBeforeRestore = await fs.readFile(iscPath, "utf-8");

			clearDerivedContinuityStateForSession(parentSessionId);
			expect(getDerivedContinuityStateForSession(parentSessionId)).toBeNull();

			await chatMessage(
				{
					sessionID: parentSessionId,
					prompt: "continue",
					parts: [{ type: "text", text: "continue" }],
				},
				{},
			);

			const restored = getDerivedContinuityStateForSession(parentSessionId);
			expect(restored).not.toBeNull();
			expect(restored?.nextUnfinishedIscIds).toContain("ISC-2");

			const prdAfterRestore = await fs.readFile(prdPath, "utf-8");
			const iscAfterRestore = await fs.readFile(iscPath, "utf-8");
			expect(prdAfterRestore).toBe(prdBeforeRestore);
			expect(iscAfterRestore).toBe(iscBeforeRestore);

			const persisted = await readCompactionDerivedStateForTests();
			const entry = persisted.sessions[parentSessionId];
			expect(entry?.restoreCount ?? 0).toBeGreaterThanOrEqual(1);
			expect(typeof entry?.lastRestoredAt).toBe("string");
		} finally {
			restoreEnv("OPENCODE_ROOT", previousRoot);
			restoreEnv("PAI_ORCHESTRATION_COMPACTION_BUNDLE_ENABLED", previousFlag);
			restoreEnv("PAI_CC_HOOKS_CONFIG_ROOT", previousConfigRoot);
			__resetPaiCcHooksSettingsCacheForTests();
		}
	});
});
