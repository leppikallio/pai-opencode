import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

function withEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
      continue;
    }

    env[key] = value;
  }

  return env;
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

async function runLoadContextHook(args: {
  paiDir: string;
  env?: Record<string, string | undefined>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/LoadContext.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      ...args.env,
      OPENCODE_ROOT: args.paiDir,
    }),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

async function createPaiFixture(args: {
  includeSkill: boolean;
  contextFiles?: string[];
}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-load-context-hook-"));
  const paiSkillDir = path.join(root, "skills", "PAI");

  await fs.mkdir(path.join(paiSkillDir, "USER"), { recursive: true });
  await fs.writeFile(path.join(paiSkillDir, "AISTEERINGRULES.md"), "SYSTEM RULES");
  await fs.writeFile(path.join(paiSkillDir, "USER", "AISTEERINGRULES.md"), "USER RULES");

  if (args.includeSkill) {
    await fs.writeFile(path.join(paiSkillDir, "SKILL.md"), "SKILL: TEST CONTEXT");
  }

  if (args.contextFiles) {
    await fs.writeFile(
      path.join(root, "settings.json"),
      `${JSON.stringify({ contextFiles: args.contextFiles }, null, 2)}\n`,
    );
  }

  return root;
}

describe("LoadContext hook reminder output", () => {
  test("outputs <system-reminder> with SKILL content", async () => {
    const fixtureDir = await createPaiFixture({ includeSkill: true });

    try {
      const result = await runLoadContextHook({ paiDir: fixtureDir });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.startsWith("<system-reminder>\n")).toBe(true);
      expect(result.stdout.endsWith("</system-reminder>\n")).toBe(true);
      expect(countOccurrences(result.stdout, "<system-reminder>")).toBe(1);
      expect(countOccurrences(result.stdout, "</system-reminder>")).toBe(1);
      expect(result.stdout).toContain("SKILL: TEST CONTEXT");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("fails when SKILL.md is missing", async () => {
    const fixtureDir = await createPaiFixture({ includeSkill: false });

    try {
      const result = await runLoadContextHook({ paiDir: fixtureDir });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("skills/PAI/SKILL.md");
      expect(result.stdout).toBe("");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("skips context output for subagent sessions", async () => {
    const fixtureDir = await createPaiFixture({ includeSkill: true });

    try {
      const result = await runLoadContextHook({
        paiDir: fixtureDir,
        env: { CLAUDE_AGENT_TYPE: "Subagent" },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("uses settings.json.contextFiles when provided", async () => {
    const fixtureDir = await createPaiFixture({
      includeSkill: true,
      contextFiles: ["skills/PAI/SKILL.md"],
    });

    try {
      const result = await runLoadContextHook({ paiDir: fixtureDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("SKILL: TEST CONTEXT");
      expect(result.stdout).not.toContain("SYSTEM RULES");
      expect(result.stdout).not.toContain("USER RULES");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("fails when settings.json.contextFiles contains absolute path", async () => {
    const fixtureDir = await createPaiFixture({
      includeSkill: true,
      contextFiles: ["/etc/passwd"],
    });

    try {
      const result = await runLoadContextHook({ paiDir: fixtureDir });

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Invalid settings.json.contextFiles entry (absolute path)");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("fails when settings.json.contextFiles contains traversal path", async () => {
    const fixtureDir = await createPaiFixture({
      includeSkill: true,
      contextFiles: ["../secrets"],
    });

    try {
      const result = await runLoadContextHook({ paiDir: fixtureDir });

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Invalid settings.json.contextFiles entry (traversal)");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("fails when configured context file is missing", async () => {
    const fixtureDir = await createPaiFixture({
      includeSkill: true,
      contextFiles: ["skills/PAI/SKILL.md", "skills/PAI/MISSING.md"],
    });

    try {
      const result = await runLoadContextHook({ paiDir: fixtureDir });

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Missing configured context file(s): skills/PAI/MISSING.md");
      expect(result.stderr).toContain("PAI_ALLOW_MISSING_CONTEXT_FILES=1");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("allows missing configured context file when env override is set", async () => {
    const fixtureDir = await createPaiFixture({
      includeSkill: true,
      contextFiles: ["skills/PAI/SKILL.md", "skills/PAI/MISSING.md"],
    });

    try {
      const result = await runLoadContextHook({
        paiDir: fixtureDir,
        env: { PAI_ALLOW_MISSING_CONTEXT_FILES: "1" },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("SKILL: TEST CONTEXT");
      expect(result.stderr).toContain("Missing configured context file(s): skills/PAI/MISSING.md");
      expect(result.stderr).toContain("PAI_ALLOW_MISSING_CONTEXT_FILES=1");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
