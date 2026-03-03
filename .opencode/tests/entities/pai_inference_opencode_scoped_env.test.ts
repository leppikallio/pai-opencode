import { describe, expect, test } from "bun:test";

import { withScopedProcessEnv } from "../../skills/PAI/Tools/opencode-scoped-env";

describe("opencode-scoped-env", () => {
	test("overlapping scopes restore PATH and PAI_CC_HOOKS_DISABLED", async () => {
		const initialPath = process.env.PATH;
		const initialHooksDisabled = process.env.PAI_CC_HOOKS_DISABLED;

		try {
			const results = await Promise.all([
				withScopedProcessEnv(
					{ PATH: "/tmp/a", PAI_CC_HOOKS_DISABLED: "1" },
					async () => {
						expect(process.env.PATH).toBe("/tmp/a");
						expect(process.env.PAI_CC_HOOKS_DISABLED).toBe("1");
						await Bun.sleep(20);
						return "a";
					},
				),
				withScopedProcessEnv(
					{ PATH: "/tmp/b", PAI_CC_HOOKS_DISABLED: "0" },
					async () => {
						expect(process.env.PATH).toBe("/tmp/b");
						expect(process.env.PAI_CC_HOOKS_DISABLED).toBe("0");
						await Bun.sleep(20);
						return "b";
					},
				),
			]);

			expect(results.sort()).toEqual(["a", "b"]);
		} finally {
			expect(process.env.PATH).toBe(initialPath);
			expect(process.env.PAI_CC_HOOKS_DISABLED).toBe(initialHooksDisabled);
		}
	});
});
