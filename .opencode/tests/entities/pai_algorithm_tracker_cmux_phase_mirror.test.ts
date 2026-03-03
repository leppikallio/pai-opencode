import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { updateAlgorithmTrackerState } from "../../hooks/lib/algorithm-tracker";
import {
	__testOnlyResetCmuxCliState,
	__testOnlySetCmuxCliExec,
} from "../../plugins/pai-cc-hooks/shared/cmux-cli";
import { createQueuedCmuxCliExecStub } from "../helpers/cmux-cli-exec-stub";

function restoreEnv(key: string, previousValue: string | undefined): void {
	if (previousValue === undefined) {
		delete process.env[key];
		return;
	}

	process.env[key] = previousValue;
}

describe("AlgorithmTracker cmux phase mirror", () => {
	beforeEach(() => {
		__testOnlyResetCmuxCliState();
	});

	afterEach(() => {
		__testOnlyResetCmuxCliState();
		__testOnlySetCmuxCliExec(null);
	});

	test("mirrors VoiceNotify phase changes into cmux status/progress", async () => {
		const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pai-alg-cmux-phase-"));
		const previousHome = process.env.HOME;
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
		const previousOpenCodeConfigRoot = process.env.OPENCODE_CONFIG_ROOT;
		const previousCmuxWorkspaceId = process.env.CMUX_WORKSPACE_ID;
		const previousCmuxSurfaceId = process.env.CMUX_SURFACE_ID;

		const stub = createQueuedCmuxCliExecStub(
			[
				{ exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
				{ exitCode: 0, stdout: "", stderr: "", signal: null, timedOut: false },
			],
			{ onEmpty: "throw" },
		);

		process.env.HOME = runtimeRoot;
		process.env.OPENCODE_ROOT = runtimeRoot;
		process.env.OPENCODE_CONFIG_ROOT = runtimeRoot;
		process.env.CMUX_WORKSPACE_ID = "workspace-test";
		process.env.CMUX_SURFACE_ID = "surface-test";
		__testOnlySetCmuxCliExec(stub.exec);

		try {
			const result = await updateAlgorithmTrackerState(
				{
					session_id: "ses_phase_mirror",
					tool_name: "VoiceNotify",
					tool_input: {
						message: "Entering the Think phase.",
					},
				},
				{
					paiDir: runtimeRoot,
					now: new Date("2026-03-03T00:00:00.000Z"),
				},
			);

			expect(result.updated).toBe(true);
			expect(stub.calls).toHaveLength(2);
			expect(stub.calls[0]?.args).toEqual([
				"set-status",
				"oc_phase",
				"THINK",
				"--workspace",
				"workspace-test",
			]);
			expect(stub.calls[1]?.args).toEqual([
				"set-progress",
				"0.2",
				"--label",
				"THINK",
				"--workspace",
				"workspace-test",
			]);
		} finally {
			restoreEnv("HOME", previousHome);
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
			restoreEnv("OPENCODE_CONFIG_ROOT", previousOpenCodeConfigRoot);
			restoreEnv("CMUX_WORKSPACE_ID", previousCmuxWorkspaceId);
			restoreEnv("CMUX_SURFACE_ID", previousCmuxSurfaceId);
			fs.rmSync(runtimeRoot, { recursive: true, force: true });
		}
	});
});
