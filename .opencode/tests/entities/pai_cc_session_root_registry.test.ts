import { beforeEach, describe, expect, test } from "bun:test";

import {
	__resetSessionRootRegistryForTests,
	MAX_ROOT_MAPPINGS,
	deleteSessionRootId,
	getSessionRootId,
	setSessionRootId,
} from "../../plugins/pai-cc-hooks/shared/session-root";

describe("pai-cc-hooks session root registry", () => {
	beforeEach(() => {
		__resetSessionRootRegistryForTests();
	});

	test("maps child sessions to root sessions", () => {
		setSessionRootId("ses_child", "ses_root");
		expect(getSessionRootId("ses_child")).toBe("ses_root");
	});

	test("returns undefined for unknown session ids", () => {
		expect(getSessionRootId("ses_missing")).toBeUndefined();
	});

	test("deletes mappings", () => {
		setSessionRootId("ses_child", "ses_root");
		deleteSessionRootId("ses_child");
		expect(getSessionRootId("ses_child")).toBeUndefined();
	});

	test("evicts oldest entries when registry exceeds max size", () => {
		for (let i = 0; i < MAX_ROOT_MAPPINGS + 1; i += 1) {
			setSessionRootId(`ses_${i}`, `root_${i}`);
		}

		expect(getSessionRootId("ses_0")).toBeUndefined();
		expect(getSessionRootId("ses_1")).toBe("root_1");
		expect(getSessionRootId(`ses_${MAX_ROOT_MAPPINGS}`)).toBe(
			`root_${MAX_ROOT_MAPPINGS}`,
		);
	});
});
