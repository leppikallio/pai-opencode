import { describe, expect, test } from "bun:test";
import { rewriteText } from "./rewrite";

describe("rewriteText", () => {
  test("rewrites command invocation", () => {
    expect(rewriteText("Use /nw:deliver now")).toBe("Use /nw/deliver now");
  });

  test("rewrites .claude templates path", () => {
    expect(rewriteText("~/.claude/nWave/templates/foo")).toBe(
      "~/.config/opencode/skills/nwave/nWave/templates/foo",
    );
  });

  test("does not rewrite Octopus", () => {
    expect(rewriteText("Octopus")).toBe("Octopus");
  });

  test("removes Co-Authored-By lines", () => {
    const input = "line 1\nCo-Authored-By: Dev <dev@example.com>\nline 2";
    expect(rewriteText(input)).toBe("line 1\nline 2");
  });

  test("rewrites python path variable", () => {
    expect(rewriteText("PYTHONPATH=$HOME/.claude/lib/python")).toBe(
      "PYTHONPATH={DES_PYTHONPATH}",
    );
  });

  test("rewrites DES CLI python invocation to poetry runner", () => {
    expect(
      rewriteText("PYTHONPATH=$HOME/.claude/lib/python python -m des.cli.log_phase"),
    ).toBe(
      "PYTHONPATH={DES_PYTHONPATH} poetry -C {NWAVE_REPO_ROOT} run python -m des.cli.log_phase",
    );
  });

  test("rewrites des.cli mention without PYTHONPATH", () => {
    expect(rewriteText("agents use DES CLI (python -m des.cli.log_phase)")).toBe(
      "agents use DES CLI (PYTHONPATH={DES_PYTHONPATH} poetry -C {NWAVE_REPO_ROOT} run python -m des.cli.log_phase)",
    );
  });

  test("rewrites scripts path", () => {
    expect(rewriteText("~/.claude/scripts/foo.py")).toBe("{NWAVE_REPO_ROOT}/scripts/foo.py");
  });

  test("rewrites python scripts invocation to poetry runner", () => {
    expect(rewriteText("python ~/.claude/scripts/foo.py")).toBe(
      "poetry -C {NWAVE_REPO_ROOT} run python {NWAVE_REPO_ROOT}/scripts/foo.py",
    );
  });

  test("rewrites agent path into opencode agents root", () => {
    expect(rewriteText("~/.claude/agents/nw/nw-researcher.md")).toBe(
      "~/.config/opencode/agents/nw-researcher.md",
    );
  });

  test("rewrites remaining .claude paths generically", () => {
    expect(rewriteText("NOT ~/.claude/AGENTS.md")).toBe("NOT ~/.config/opencode/AGENTS.md");
  });

  test("keeps canonical model labels", () => {
    expect(rewriteText("haiku sonnet opus")).toBe("haiku sonnet opus");
  });

  test("rewrites nWave mirror data refs to runtime paths", () => {
    expect(rewriteText("nWave/data/config/trusted-source-domains.yaml")).toBe(
      "skills/nwave/nWave/data/config/trusted-source-domains.yaml",
    );
  });

  test("rewrites nWave mirror template refs to runtime paths", () => {
    expect(rewriteText("nWave/templates/roadmap-schema.yaml")).toBe(
      "skills/nwave/nWave/templates/roadmap-schema.yaml",
    );
  });

  test("rewrites project docs refs into placeholders", () => {
    expect(rewriteText("docs/discovery/problem-validation.md")).toBe(
      "{PROJECT_ROOT}/docs/discovery/problem-validation.md",
    );
  });

  test("does not rewrite runtime docs refs", () => {
    expect(rewriteText("~/.config/opencode/docs/README.md")).toBe(
      "~/.config/opencode/docs/README.md",
    );
  });

  test("rewrites project config refs into placeholders", () => {
    expect(rewriteText("config/paths.yaml")).toBe("{PROJECT_ROOT}/config/paths.yaml");
  });
});
