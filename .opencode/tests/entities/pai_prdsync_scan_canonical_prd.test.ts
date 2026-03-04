import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { scanCanonicalPrdInSessionDir } from "../../hooks/lib/prd-utils";

describe("scanCanonicalPrdInSessionDir", () => {
  test("prefers v2 identity slug over legacy candidates", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "pai-prdsync-canonical-meta-"));

    try {
      const expectedPath = path.join(sessionDir, "PRD.md");
      await writeFile(
        path.join(sessionDir, "PRD-20260304-legacy.md"),
        [
          "---",
          "task: Legacy",
          "slug: legacy-candidate",
          "updated: 2026-03-04T09:00:00.000Z",
          "---",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        expectedPath,
        [
          "---",
          "task: V2",
          "slug: 20260304-080000-my-expected-session-a1b2c3d4",
          "updated: 2026-03-04T08:00:00.000Z",
          "---",
          "",
        ].join("\n"),
        "utf8",
      );

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
