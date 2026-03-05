import { beforeEach, describe, expect, test } from "bun:test";

import {
	__resetSessionRootRegistryForTests,
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
});
