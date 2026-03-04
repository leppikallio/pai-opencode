import { describe, expect, test } from "bun:test";

import {
  extractApplyPatchPaths,
  resolveApplyPatchPaths,
} from "../../plugins/handlers/security-validator";

describe("security-validator apply_patch move handling", () => {
  test("captures Move to destination as a write path", () => {
    const patchText = [
      "*** Begin Patch",
      '*** Update File: "MEMORY\\WORK\\2026-03\\session-1\\PRD-20260304-old.md"',
      '*** Move to: "MEMORY\\WORK\\2026-03\\session-1\\PRD-20260304-new.md"',
      "*** End Patch",
      "",
    ].join("\n");

    expect(extractApplyPatchPaths(patchText)).toEqual([
      { action: "delete", filePath: "MEMORY/WORK/2026-03/session-1/PRD-20260304-old.md" },
      { action: "write", filePath: "MEMORY/WORK/2026-03/session-1/PRD-20260304-new.md" },
    ]);
  });

  test("normalizes quoted backslash paths before resolving", () => {
    const resolved = resolveApplyPatchPaths({
      paiDir: "/tmp/pai-root",
      cwd: "/tmp/workspace",
      filePathRaw: '"MEMORY\\WORK\\2026-03\\session-1\\PRD-20260304-new.md"',
    });

    expect(resolved).toEqual([
      "/tmp/workspace/MEMORY/WORK/2026-03/session-1/PRD-20260304-new.md",
      "/tmp/pai-root/MEMORY/WORK/2026-03/session-1/PRD-20260304-new.md",
    ]);
  });
});
