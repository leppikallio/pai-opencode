import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const importToolPath = path.join(
  repoRoot,
  ".opencode",
  "skills",
  "utilities",
  "create-skill",
  "Tools",
  "ImportSkill.ts",
);

test("ImportSkill minimal canonicalization rewrites legacy superpowers runtime paths", () => {
  const sourceRoot = mkdtempSync(path.join(tmpdir(), "pai-import-src-"));
  const destRoot = mkdtempSync(path.join(tmpdir(), "pai-import-dest-"));

  try {
    const sourceSkillDir = path.join(sourceRoot, "legacy-worktree-skill");
    mkdirSync(sourceSkillDir, { recursive: true });

    const sourceSkillMd = `---
name: legacy-worktree-skill
description: "Import fixture for path normalization. USE WHEN validating canonicalization."
---
# Fixture

- Global worktrees: ~/.config/superpowers/worktrees/<project-name>/
- Hooks path: ~/.config/superpowers/hooks/
`;

    writeFileSync(path.join(sourceSkillDir, "SKILL.md"), sourceSkillMd, "utf8");

    const run = spawnSync(
      "bun",
      [
        importToolPath,
        "--source",
        sourceSkillDir,
        "--dest",
        destRoot,
        "--name",
        "tmp-skill",
        "--canonicalize",
        "minimal",
      ],
      {
        encoding: "utf8",
        shell: false,
      },
    );

    const combinedOutput = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    expect(run.status, combinedOutput).toBe(0);

    const importedSkillPath = path.join(destRoot, "tmp-skill", "SKILL.md");
    const imported = readFileSync(importedSkillPath, "utf8");

    expect(imported).toContain("~/.config/opencode/worktrees/<project-name>/");
    expect(imported).toContain("~/.config/opencode/hooks/");
    expect(imported).not.toContain(".config/superpowers");
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(destRoot, { recursive: true, force: true });
  }
});

test("ImportSkill minimal canonicalization rewrites legacy .claude skill paths", () => {
  const sourceRoot = mkdtempSync(path.join(tmpdir(), "pai-import-src-"));
  const destRoot = mkdtempSync(path.join(tmpdir(), "pai-import-dest-"));

  try {
    const sourceSkillDir = path.join(sourceRoot, "legacy-claude-skill");
    mkdirSync(sourceSkillDir, { recursive: true });

    const sourceReadme = `Install globally: ~/.claude/skills/legacy-claude-skill/
Install locally: .claude/skills/legacy-claude-skill/
Absolute path: /Users/alice/.claude/skills/legacy-claude-skill/
Literal token (not a runtime path): docs.claude/reference
`;

    const sourceSkillMd = `---
name: legacy-claude-skill
description: "Import fixture for .claude path normalization. USE WHEN validating canonicalization."
---
# Fixture
`;

    writeFileSync(path.join(sourceSkillDir, "SKILL.md"), sourceSkillMd, "utf8");
    writeFileSync(path.join(sourceSkillDir, "README.md"), sourceReadme, "utf8");

    const run = spawnSync(
      "bun",
      [
        importToolPath,
        "--source",
        sourceSkillDir,
        "--dest",
        destRoot,
        "--name",
        "tmp-claude-skill",
        "--canonicalize",
        "minimal",
      ],
      {
        encoding: "utf8",
        shell: false,
      },
    );

    const combinedOutput = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    expect(run.status, combinedOutput).toBe(0);

    const importedReadmePath = path.join(destRoot, "tmp-claude-skill", "README.md");
    const importedReadme = readFileSync(importedReadmePath, "utf8");

    expect(importedReadme).toContain("~/.config/opencode/skills/tmp-claude-skill/");
    expect(importedReadme).toContain(".opencode/skills/tmp-claude-skill/");
    expect(importedReadme).toContain("/Users/alice/.config/opencode/skills/tmp-claude-skill/");
    expect(importedReadme).toContain("docs.claude/reference");
    expect(importedReadme).not.toContain(".claude/skills/");
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(destRoot, { recursive: true, force: true });
  }
});
