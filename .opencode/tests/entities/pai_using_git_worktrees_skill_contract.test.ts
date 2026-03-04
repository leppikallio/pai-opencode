import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const skillPath = path.join(
  repoRoot,
  ".opencode",
  "skills",
  "utilities",
  "using-git-worktrees",
  "SKILL.md",
);

describe("using-git-worktrees skill contract", () => {
  test("uses OpenCode global worktree location and not legacy superpowers path", () => {
    const md = readFileSync(skillPath, "utf8");
    expect(md).toContain("~/.config/opencode/worktrees/<project-name>/");
    expect(md).not.toContain("~/.config/superpowers/worktrees/<project-name>/");
  });

  test("REFERENCE probe is explicitly optional and guarded by file existence", () => {
    const md = readFileSync(skillPath, "utf8");
    expect(md).toContain("if [ -f REFERENCE.md ]; then");
    expect(md).toContain("If REFERENCE.md exists");
  });
});
