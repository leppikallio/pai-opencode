import { describe, expect, test } from "bun:test";

import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";

describe("PAI task tool copy contract for native general routing", () => {
	test("description keeps native routing and background extension language stable", () => {
		const taskTool = createPaiTaskTool({
			client: {},
			$: (() => Promise.resolve(null)) as unknown,
		}) as { description?: string };

		expect(typeof taskTool.description).toBe("string");
		expect(taskTool.description).toContain("@general / @<agent>");
		expect(taskTool.description).toContain("run_in_background:true");
		expect(taskTool.description).toContain(
			"native `general` as the catch-all fallback",
		);
		expect(taskTool.description).toContain("Intern for broad parallel grunt work");
		expect(taskTool.description).not.toContain("general-purpose");
	});
});
