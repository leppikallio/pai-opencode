import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { scanCanonicalPrdInSessionDir } from "../../hooks/lib/prd-utils";

describe("scanCanonicalPrdInSessionDir", () => {
  test("prefers META-derived expected PRD file when present", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "pai-prdsync-canonical-meta-"));

    try {
      await writeFile(
        path.join(sessionDir, "META.yaml"),
        [
          'title: "My Expected Session"',
          "started_at: 2026-03-04T08:00:00.000Z",
          "",
        ].join("\n"),
        "utf8",
      );

      const expectedPath = path.join(sessionDir, "PRD-20260304-my-expected-session.md");
      await writeFile(path.join(sessionDir, "PRD-20260304-a-lex-first.md"), "# fallback\n", "utf8");
      await writeFile(expectedPath, "# expected\n", "utf8");

      const canonical = await scanCanonicalPrdInSessionDir(sessionDir);
      expect(canonical).toBe(expectedPath);
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  test("does not recurse into nested directories", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "pai-prdsync-canonical-root-only-"));
    const nestedDir = path.join(sessionDir, "nested");

    try {
      await mkdir(nestedDir, { recursive: true });
      await writeFile(path.join(nestedDir, "PRD-20260304-nested.md"), "# nested\n", "utf8");

      const canonical = await scanCanonicalPrdInSessionDir(sessionDir);
      expect(canonical).toBeNull();
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});
