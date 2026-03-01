import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const opencodeRoot = path.join(repoRoot, ".opencode");

describe("algorithm v3.5.0 opencode binding lint", () => {
  test("v3.5.0-opencode.md exists and contains only OpenCode-valid bindings", () => {
    const algorithmPath = path.join(
      opencodeRoot,
      "skills",
      "PAI",
      "Components",
      "Algorithm",
      "v3.5.0-opencode.md",
    );

    expect(existsSync(algorithmPath)).toBe(true);

    const text = readFileSync(algorithmPath, "utf8");

    // Forbidden Claude-only references.
    expect(text).not.toContain("~/.claude/");
    expect(text).not.toContain("CLAUDE.md");
    expect(text).not.toContain("work.json");
    expect(text).not.toContain("PRDSync");
    expect(text).not.toContain("PRDSync.hook.ts");

    // Forbidden voice transport.
    expect(text).not.toContain("curl -s -X POST http://localhost:8888/notify");
    expect(text).not.toContain("curl");

    // Required OpenCode tool bindings.
    expect(text).toContain("voice_notify");
    expect(text).toContain("question");
    expect(text).toContain("run_in_background");

    // Required OpenCode runtime paths.
    expect(text).toContain("~/.config/opencode/PAISYSTEM/PRDFORMAT.md");
    expect(text).toContain("~/.config/opencode/MEMORY/STATE/current-work.json");

    // Required enforcement markers (must match enforcement gate expectations).
    expect(text).toMatch(/🤖\s+(?:PAI ALGORITHM\b|Entering the PAI ALGORITHM)/);
    expect(text).toMatch(/^🗣️\s*[^:\n]{1,40}:/m);
    expect(text).toMatch(/ISC\s+(?:TRACKER|Tasks)|FINAL\s+ISC\s+STATE/i);
    expect(text).toMatch(/\b(OBSERVE|THINK|PLAN|BUILD|EXECUTE|VERIFY|LEARN)\b/);

    // Activation preconditions must be explicit in the bound variant.
    expect(text).toContain(
      "OPEN-CODE CONSTITUTION: Keep enforcement-gate contract; v3.5.0 adapts to it.",
    );
  });
});
