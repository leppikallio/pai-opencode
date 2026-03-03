import { describe, expect, test } from "bun:test";
import * as path from "node:path";

import {
	buildPathWithBinaryFirst,
	collectCandidateBinaryPaths,
	findWorkingOpencodeBinary,
} from "../../skills/PAI/Tools/opencode-binary-resolver";

describe("opencode-binary-resolver", () => {
	test("buildPathWithBinaryFirst prepends binary dir", () => {
		const out = buildPathWithBinaryFirst("/a:/b", "/x/opencode", "darwin");
		const parts = out.split(path.delimiter);
		expect(parts[0]).toBe("/x");
		expect(parts).toContain("/a");
		expect(parts).toContain("/b");
	});

	test("collectCandidateBinaryPaths includes which result", () => {
		const fakeWhich = (cmd: string) =>
			cmd === "opencode" ? "/x/opencode" : null;
		const candidates = collectCandidateBinaryPaths(
			"/a:/b",
			fakeWhich,
			"darwin",
		);
		expect(candidates).toContain("/x/opencode");
	});

	test("findWorkingOpencodeBinary returns first probe-ok candidate", async () => {
		const collect = () => ["/a/opencode", "/b/opencode"];
		const probe = async (p: string) => p === "/b/opencode";
		const result = await findWorkingOpencodeBinary(
			"/a:/b",
			probe,
			() => null,
			"darwin",
			collect,
		);
		expect(result).toBe("/b/opencode");
	});
});
