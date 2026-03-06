import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";
import {
	__resetSessionRootRegistryForTests,
	setSessionRootId,
} from "../../plugins/pai-cc-hooks/shared/session-root";

const SCRATCHPAD_BINDING_MARKER = "PAI SCRATCHPAD (Binding)";

describe("PAI task tool prompt prefix", () => {
	test("prefixes child prompt with scratchpad binding marker", async () => {
		const xdgHome = await fs.mkdtemp(
			path.join(os.tmpdir(), "pai-task-tool-prompt-prefix-"),
		);
		const previousXdg = process.env.XDG_CONFIG_HOME;
		const promptCalls: unknown[] = [];

		__resetSessionRootRegistryForTests();

		try {
			process.env.XDG_CONFIG_HOME = xdgHome;
			setSessionRootId("parent-session-456", "root-session-999");

			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async () => ({ data: { id: "child-session-123" } }),
						prompt: async (payload: unknown) => {
							promptCalls.push(payload);
							return { data: { parts: [{ type: "text", text: "unused" }] } };
						},
					},
				},
				$: (() => Promise.resolve(null)) as unknown,
			});

			await taskTool.execute(
				{
					description: "Run subagent",
					prompt: "Do the thing",
					subagent_type: "Engineer",
					run_in_background: true,
				},
				{
					sessionID: "parent-session-456",
					directory: "/tmp/workspace",
				} as any,
			);

			expect(promptCalls).toHaveLength(1);
			const promptPayload = promptCalls[0] as {
				body?: {
					parts?: Array<{ type?: string; text?: string }>;
				};
			};
			const firstPartText = promptPayload.body?.parts?.[0]?.text ?? "";

			expect(firstPartText.startsWith(SCRATCHPAD_BINDING_MARKER)).toBe(true);
			expect(firstPartText).toContain(
				`ScratchpadDir: ${path.join(
					xdgHome,
					"opencode",
					"scratchpad",
					"sessions",
					"root-session-999",
				)}`,
			);
			expect(firstPartText).toContain("Do the thing");
		} finally {
			if (previousXdg === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = previousXdg;
			}
			__resetSessionRootRegistryForTests();
			await fs.rm(xdgHome, { recursive: true, force: true });
		}
	});
});
