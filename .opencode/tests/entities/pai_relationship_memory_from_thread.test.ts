import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const FIXED_TIME_ISO = "2099-01-02T03:04:05.000Z";

function createTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-hook-thread-"));
}

function writeCurrentWorkState(root: string, sessions: Record<string, { work_dir: string }>): void {
  const stateDir = path.join(root, "MEMORY", "STATE");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "current-work.json"),
    JSON.stringify(
      {
        v: "0.2",
        updated_at: new Date().toISOString(),
        sessions,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

async function runHook(args: { script: string; payload: unknown; paiDir: string }): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["bun", args.script],
    cwd: repoRoot,
    env: {
      ...process.env,
      PAI_DIR: args.paiDir,
      PAI_HOOK_FIXED_TIME_ISO: FIXED_TIME_ISO,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(JSON.stringify(args.payload));
  proc.stdin.end();

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
}

describe("thread-based hook projections", () => {
  test("RelationshipMemory and IntegrityCheck append THREAD.md excerpts", async () => {
    const root = createTempRoot();
    try {
      const workDir = path.join(root, "MEMORY", "WORK", "2099-01", "ses_abc");
      fs.mkdirSync(workDir, { recursive: true });

      writeCurrentWorkState(root, { ses_abc: { work_dir: workDir } });

      const thread = [
        "# THREAD",
        "",
        "line 1",
        "line 2",
        "tail line A",
        "tail line B 🙂",
      ].join("\n");
      fs.writeFileSync(path.join(workDir, "THREAD.md"), thread, "utf-8");

      await runHook({
        script: ".opencode/hooks/RelationshipMemory.hook.ts",
        payload: { session_id: "ses_abc" },
        paiDir: root,
      });

      await runHook({
        script: ".opencode/hooks/IntegrityCheck.hook.ts",
        payload: { sessionId: "ses_abc" },
        paiDir: root,
      });

      const relationshipPath = path.join(workDir, "RELATIONSHIP_HOOK.md");
      const integrityPath = path.join(workDir, "INTEGRITY_HOOK.md");

      expect(fs.existsSync(relationshipPath)).toBe(true);
      expect(fs.existsSync(integrityPath)).toBe(true);

      const relationshipContent = fs.readFileSync(relationshipPath, "utf-8");
      const integrityContent = fs.readFileSync(integrityPath, "utf-8");

      expect(relationshipContent).toContain(`## ${FIXED_TIME_ISO}`);
      expect(integrityContent).toContain(`## ${FIXED_TIME_ISO}`);
      expect(relationshipContent).toContain("tail line B 🙂");
      expect(integrityContent).toContain("tail line B 🙂");
      expect(relationshipContent).toContain("```md");
      expect(integrityContent).toContain("```md");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("RelationshipMemory hook also triggers relationship daily capture", async () => {
    const root = createTempRoot();
    try {
      const workDir = path.join(root, "MEMORY", "WORK", "2099-01", "ses_capture");
      fs.mkdirSync(workDir, { recursive: true });
      writeCurrentWorkState(root, { ses_capture: { work_dir: workDir } });

      const thread = [
        "# THREAD",
        "",
        "**User:** I prefer direct updates and clear progress.",
        "**Assistant:** 📋 SUMMARY: Closed Task 7 implementation for relationship capture.",
      ].join("\n");
      fs.writeFileSync(path.join(workDir, "THREAD.md"), thread, "utf-8");

      await runHook({
        script: ".opencode/hooks/RelationshipMemory.hook.ts",
        payload: { session_id: "ses_capture" },
        paiDir: root,
      });

      const relationshipPath = path.join(workDir, "RELATIONSHIP_HOOK.md");
      expect(fs.existsSync(relationshipPath)).toBe(true);

      const now = new Date();
      const yearMonth = now.toISOString().slice(0, 7);
      const date = now.toISOString().slice(0, 10);
      const dailyPath = path.join(root, "MEMORY", "RELATIONSHIP", yearMonth, `${date}.md`);

      expect(fs.existsSync(dailyPath)).toBe(true);
      const dailyContent = fs.readFileSync(dailyPath, "utf-8");
      expect(dailyContent).toContain("Closed Task 7 implementation for relationship capture.");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("RelationshipMemory no-ops when session mapping is missing", async () => {
    const root = createTempRoot();
    try {
      const workDir = path.join(root, "MEMORY", "WORK", "2099-01", "ses_missing");
      fs.mkdirSync(workDir, { recursive: true });
      writeCurrentWorkState(root, {});

      await runHook({
        script: ".opencode/hooks/RelationshipMemory.hook.ts",
        payload: { session_id: "ses_missing" },
        paiDir: root,
      });

      expect(fs.existsSync(path.join(workDir, "RELATIONSHIP_HOOK.md"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("RelationshipMemory no-ops when THREAD.md is missing", async () => {
    const root = createTempRoot();
    try {
      const workDir = path.join(root, "MEMORY", "WORK", "2099-01", "ses_no_thread");
      fs.mkdirSync(workDir, { recursive: true });
      writeCurrentWorkState(root, { ses_no_thread: { work_dir: workDir } });

      await runHook({
        script: ".opencode/hooks/RelationshipMemory.hook.ts",
        payload: { session_id: "ses_no_thread" },
        paiDir: root,
      });

      expect(fs.existsSync(path.join(workDir, "RELATIONSHIP_HOOK.md"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
