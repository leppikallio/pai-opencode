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

async function createPaiFixture(args?: {
  settings?: Record<string, unknown>;
  startupFiles?: Record<string, string>;
  includeSkill?: boolean;
}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-load-context-hook-"));

  await fs.mkdir(path.join(root, "MEMORY", "RELATIONSHIP", "2026-03"), { recursive: true });
  await fs.mkdir(path.join(root, "MEMORY", "LEARNING"), { recursive: true });
  await fs.mkdir(path.join(root, "MEMORY", "STATE"), { recursive: true });
  await fs.mkdir(path.join(root, "skills", "PAI"), { recursive: true });

  if (args?.includeSkill) {
    await fs.writeFile(path.join(root, "skills", "PAI", "SKILL.md"), "SKILL: TEST CONTEXT\n", "utf8");
  }

  await fs.writeFile(
    path.join(root, "MEMORY", "RELATIONSHIP", "2026-03", "2026-03-04.md"),
    "# Relationship Notes: 2026-03-04\n\n## 10:15\n\n- B @Marvin: Session stayed focused\n",
    "utf8",
  );
  await fs.writeFile(path.join(root, "MEMORY", "LEARNING", "digest.md"), "# Learning Digest\n- Keep hooks fail-open\n", "utf8");
  await fs.writeFile(
    path.join(root, "MEMORY", "STATE", "current-work.json"),
    `${JSON.stringify({
      v: "0.2",
      updated_at: "2026-03-04T10:00:00.000Z",
      session_id: "ses_abc",
      sessions: {
        ses_abc: {
          work_dir: path.join(root, "MEMORY", "WORK", "task-alpha"),
          started_at: "2026-03-04T09:58:00.000Z",
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );

  if (args?.startupFiles) {
    for (const [relativePath, content] of Object.entries(args.startupFiles)) {
      const fullPath = path.join(root, relativePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf8");
    }
  }

  if (args?.settings) {
    await fs.writeFile(path.join(root, "settings.json"), `${JSON.stringify(args.settings, null, 2)}\n`, "utf8");
  }

  return root;
}

describe("LoadContext hook reminder output", () => {
  test("outputs dynamic summaries by default and does not require SKILL.md", async () => {
    const fixtureDir = await createPaiFixture({ includeSkill: false });

    try {
      const result = await runLoadContextHook({ paiDir: fixtureDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.startsWith("<system-reminder>\n")).toBe(true);
      expect(result.stdout.endsWith("</system-reminder>\n")).toBe(true);
      expect(result.stdout).toContain("Session stayed focused");
      expect(result.stdout).toContain("Keep hooks fail-open");
      expect(result.stdout).toContain("ses_abc");
      expect(result.stdout).toContain("task-alpha");
      expect(result.stdout).not.toContain("SKILL: TEST CONTEXT");
      expect(result.stderr).toBe("");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("ignores legacy settings.json.contextFiles for SessionStart injection", async () => {
    const fixtureDir = await createPaiFixture({
      includeSkill: true,
      settings: {
        contextFiles: ["skills/PAI/SKILL.md"],
      },
    });

    try {
      const result = await runLoadContextHook({ paiDir: fixtureDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Session stayed focused");
      expect(result.stdout).toContain("Keep hooks fail-open");
      expect(result.stdout).not.toContain("SKILL: TEST CONTEXT");
      expect(result.stderr).toContain("settings.json.contextFiles is legacy and ignored");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("loadAtStartup.files validates paths and dedupes entries", async () => {
    const fixtureDir = await createPaiFixture({
      startupFiles: {
        "docs/extra.md": "EXTRA CONTEXT BLOCK\n",
      },
      settings: {
        loadAtStartup: {
          files: [
            "docs/extra.md",
            "docs/extra.md",
            "../secrets.md",
            "/etc/passwd",
            42,
          ],
        },
      },
    });

    try {
      const result = await runLoadContextHook({ paiDir: fixtureDir });

      expect(result.exitCode).toBe(0);
      expect(countOccurrences(result.stdout, "EXTRA CONTEXT BLOCK")).toBe(1);
      expect(result.stderr).toContain("Duplicate loadAtStartup.files entry dropped: docs/extra.md");
      expect(result.stderr).toContain("Ignoring loadAtStartup.files entry (traversal): ../secrets.md");
      expect(result.stderr).toContain("Ignoring loadAtStartup.files entry (absolute path): /etc/passwd");
      expect(result.stderr).toContain("Ignoring loadAtStartup.files entry: expected string");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("missing optional loadAtStartup file warns and continues (fail-open)", async () => {
    const fixtureDir = await createPaiFixture({
      startupFiles: {
        "docs/exists.md": "EXISTS\n",
      },
      settings: {
        loadAtStartup: {
          files: ["docs/exists.md", "docs/missing.md"],
        },
      },
    });

    try {
      const result = await runLoadContextHook({ paiDir: fixtureDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("EXISTS");
      expect(result.stderr).toContain("Missing optional context file: docs/missing.md");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("ignores CLAUDE_* subagent markers and still loads context", async () => {
    const fixtureDir = await createPaiFixture();

    try {
      const result = await runLoadContextHook({
        paiDir: fixtureDir,
        env: { CLAUDE_AGENT_TYPE: "Subagent" },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Session stayed focused");
      expect(result.stderr).toContain("Ignoring legacy CLAUDE_* subagent markers");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("skips context output for OPENCODE subagent sessions", async () => {
    const fixtureDir = await createPaiFixture();

    try {
      const result = await runLoadContextHook({
        paiDir: fixtureDir,
        env: { OPENCODE_AGENT_TYPE: "Subagent" },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
