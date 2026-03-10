import { describe, expect, test } from "bun:test";

import PaiRtkPlugin from "../../plugins/pai-rtk";

describe("pai-rtk plugin compatibility shim", () => {
	test("does not expose a standalone runtime rewrite hook", async () => {
		const plugin = await PaiRtkPlugin({ client: {}, $: {}, config: {} } as any);
		expect((plugin as Record<string, unknown>)["tool.execute.before"]).toBeUndefined();
	});
});
