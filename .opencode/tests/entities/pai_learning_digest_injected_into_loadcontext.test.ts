import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadContextBundle, resolveContextFiles } from "../../hooks/lib/context-loader";

async function createPaiFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-loadcontext-settings-"));

  await fs.mkdir(path.join(root, "MEMORY", "RELATIONSHIP", "2026-03"), { recursive: true });
  await fs.mkdir(path.join(root, "MEMORY", "LEARNING"), { recursive: true });
  await fs.mkdir(path.join(root, "MEMORY", "STATE"), { recursive: true });
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.mkdir(path.join(root, "skills", "PAI"), { recursive: true });

  await fs.writeFile(
    path.join(root, "MEMORY", "RELATIONSHIP", "2026-03", "2026-03-04.md"),
    "# Relationship Notes\n\n- B @Marvin: Dynamic context enabled by default\n",
    "utf8",
  );
  await fs.writeFile(path.join(root, "MEMORY", "LEARNING", "digest.md"), "# Learning\n- Keep summaries small\n", "utf8");
  await fs.writeFile(
    path.join(root, "MEMORY", "STATE", "current-work.json"),
    `${JSON.stringify({
      v: "0.2",
      session_id: "ses_test",
      sessions: {
        ses_test: {
          work_dir: path.join(root, "MEMORY", "WORK", "task-one"),
          started_at: "2026-03-04T10:00:00.000Z",
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(root, "docs", "context.md"), "EXTRA FILE CONTEXT\n", "utf8");
  await fs.writeFile(path.join(root, "skills", "PAI", "SKILL.md"), "SKILL: SHOULD NOT AUTOLOAD\n", "utf8");

  return root;
}

describe("LoadContext settings semantics", () => {
  test("dynamicContext defaults ON when missing", async () => {
    const fixtureDir = await createPaiFixture();

    try {
      const bundle = loadContextBundle(fixtureDir);
      expect(bundle.dynamicContextEnabled).toBe(true);
      expect(bundle.combinedContent).toContain("Dynamic context enabled by default");
      expect(bundle.combinedContent).toContain("Keep summaries small");
      expect(bundle.combinedContent).toContain("ses_test");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("settings.contextFiles is ignored for SessionStart injection", async () => {
    const fixtureDir = await createPaiFixture();

    try {
      const settings = {
        contextFiles: ["skills/PAI/SKILL.md"],
      };
      const resolved = resolveContextFiles(settings, fixtureDir);
      await fs.writeFile(path.join(fixtureDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      const bundle = loadContextBundle(fixtureDir);

      expect(resolved.contextFiles).toEqual([]);
      expect(resolved.warnings.join("\n")).toContain("contextFiles is legacy and ignored");
      expect(bundle.warnings.join("\n")).toContain("contextFiles is legacy and ignored");
      expect(bundle.combinedContent).not.toContain("SKILL: SHOULD NOT AUTOLOAD");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("loadAtStartup.files validates paths and dedupes", async () => {
    const fixtureDir = await createPaiFixture();

    try {
      const settings = {
        loadAtStartup: {
          files: [
            "docs/context.md",
            "docs/context.md",
            "../secret.md",
            "/etc/passwd",
            123,
          ],
        },
      };

      const resolved = resolveContextFiles(settings, fixtureDir);
      expect(resolved.contextFiles).toEqual(["docs/context.md"]);
      expect(resolved.warnings.join("\n")).toContain("Duplicate loadAtStartup.files entry dropped: docs/context.md");
      expect(resolved.warnings.join("\n")).toContain("Ignoring loadAtStartup.files entry (traversal): ../secret.md");
      expect(resolved.warnings.join("\n")).toContain("Ignoring loadAtStartup.files entry (absolute path): /etc/passwd");
      expect(resolved.warnings.join("\n")).toContain("Ignoring loadAtStartup.files entry: expected string");

      await fs.writeFile(path.join(fixtureDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      const bundle = loadContextBundle(fixtureDir);
      expect(bundle.combinedContent).toContain("EXTRA FILE CONTEXT");
      expect(bundle.missingFiles).toEqual([]);
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("loadAtStartup.files rejects symlink breakouts and continues fail-open", async () => {
    const fixtureDir = await createPaiFixture();
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-loadcontext-outside-"));

    try {
      await fs.writeFile(path.join(outsideDir, "secret.md"), "OUTSIDE SECRET\n", "utf8");
      await fs.symlink(outsideDir, path.join(fixtureDir, "docs", "outside-link"));

      const settings = {
        loadAtStartup: {
          files: ["docs/context.md", "docs/outside-link/secret.md"],
        },
      };

      const resolved = resolveContextFiles(settings, fixtureDir);
      expect(resolved.contextFiles).toEqual(["docs/context.md"]);
      expect(resolved.warnings.join("\n")).toContain(
        "Ignoring loadAtStartup.files entry (outside runtime root): docs/outside-link/secret.md",
      );

      await fs.writeFile(path.join(fixtureDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      const bundle = loadContextBundle(fixtureDir);
      expect(bundle.combinedContent).toContain("EXTRA FILE CONTEXT");
      expect(bundle.combinedContent).not.toContain("OUTSIDE SECRET");
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("loadAtStartup.files rejects outside symlink path when nearest parent exists but leaf is missing", async () => {
    const fixtureDir = await createPaiFixture();
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-loadcontext-outside-missing-"));

    try {
      await fs.symlink(outsideDir, path.join(fixtureDir, "docs", "outside-link"));

      const settings = {
        loadAtStartup: {
          files: ["docs/context.md", "docs/outside-link/missing.md"],
        },
      };

      const resolved = resolveContextFiles(settings, fixtureDir);
      expect(resolved.contextFiles).toEqual(["docs/context.md"]);
      expect(resolved.warnings.join("\n")).toContain(
        "Ignoring loadAtStartup.files entry (outside runtime root): docs/outside-link/missing.md",
      );

      await fs.writeFile(path.join(fixtureDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      const bundle = loadContextBundle(fixtureDir);
      expect(bundle.combinedContent).toContain("EXTRA FILE CONTEXT");
      expect(bundle.combinedContent).not.toContain("outside-link");
      expect(bundle.missingFiles).toEqual([]);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("loadAtStartup.files dedupes equivalent canonical relative paths", async () => {
    const fixtureDir = await createPaiFixture();

    try {
      const settings = {
        loadAtStartup: {
          files: ["docs/context.md", "./docs/context.md"],
        },
      };

      const resolved = resolveContextFiles(settings, fixtureDir);
      expect(resolved.contextFiles).toEqual(["docs/context.md"]);
      expect(resolved.warnings.join("\n")).toContain("Duplicate loadAtStartup.files entry dropped: docs/context.md");

      await fs.writeFile(path.join(fixtureDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      const bundle = loadContextBundle(fixtureDir);
      expect(bundle.combinedContent.split("EXTRA FILE CONTEXT").length - 1).toBe(1);
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
