import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { captureRelationshipMemory } from "../../plugins/handlers/relationship-memory";
import { clearCache as clearIdentityCache } from "../../plugins/lib/identity";

function createTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-relationship-memory-"));
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

function dailyRelationshipPath(root: string): string {
  const now = new Date();
  const yearMonth = now.toISOString().slice(0, 7);
  const date = now.toISOString().slice(0, 10);
  return path.join(root, "MEMORY", "RELATIONSHIP", yearMonth, `${date}.md`);
}

async function withRuntimeEnv<T>(args: {
  root: string;
  env?: Record<string, string | undefined>;
  run: () => Promise<T>;
}): Promise<T> {
  const env = args.env ?? {};
  const keys = [...new Set(["OPENCODE_ROOT", "PAI_DIR", ...Object.keys(env)])];
  const previous: Record<string, string | undefined> = {};

  for (const key of keys) {
    previous[key] = process.env[key];
  }

  process.env.OPENCODE_ROOT = args.root;
  delete process.env.PAI_DIR;

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  clearIdentityCache();
  try {
    return await args.run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearIdentityCache();
  }
}

describe("captureRelationshipMemory daily writes", () => {
  test("writes B and O notes from SUMMARY/VOICE markers and omits W by default", async () => {
    const root = createTempRoot();
    const sessionId = "ses_daily_default";
    const workDir = path.join(root, "MEMORY", "WORK", "2099-01", sessionId);
    fs.mkdirSync(workDir, { recursive: true });
    writeCurrentWorkState(root, { [sessionId]: { work_dir: workDir } });

    const thread = [
      "# THREAD",
      "",
      "**User:** I prefer concise updates and clear next steps.",
      "**User:** Thanks for the fast turnaround.",
      "**Assistant:** 📋 SUMMARY: Completed parity checks and hook integration.",
      "**Assistant:** 🗣️ Marvin: Finalized relationship capture at session end.",
    ].join("\n");
    fs.writeFileSync(path.join(workDir, "THREAD.md"), thread, "utf-8");

    try {
      await withRuntimeEnv({
        root,
        run: async () => {
          await captureRelationshipMemory(sessionId);
        },
      });

      const dailyPath = dailyRelationshipPath(root);
      expect(fs.existsSync(dailyPath)).toBe(true);

      const content = fs.readFileSync(dailyPath, "utf-8");
      expect(content).toContain("Completed parity checks and hook integration.");
      expect(content).toContain("Finalized relationship capture at session end.");
      expect(content).toContain("I prefer concise updates and clear next steps.");
      expect(content).toContain("- B");
      expect(content).toContain("- O");
      expect(content).not.toContain("- W");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes at most two W notes when world-notes flag is enabled", async () => {
    const root = createTempRoot();
    const sessionId = "ses_daily_world";
    const workDir = path.join(root, "MEMORY", "WORK", "2099-01", sessionId);
    fs.mkdirSync(workDir, { recursive: true });
    writeCurrentWorkState(root, { [sessionId]: { work_dir: workDir } });

    const thread = [
      "# THREAD",
      "",
      "**User:** World note: Canonical ordering uses SessionEnd hooks.",
      "**User:** World fact: Relationship capture no longer depends on session.idle.",
      "**User:** World note: This third fact should be ignored by max-note capping.",
      "**Assistant:** 📋 SUMMARY: Added world-note extraction gate.",
    ].join("\n");
    fs.writeFileSync(path.join(workDir, "THREAD.md"), thread, "utf-8");

    try {
      await withRuntimeEnv({
        root,
        env: {
          PAI_ENABLE_RELATIONSHIP_WORLD_NOTES: "1",
        },
        run: async () => {
          await captureRelationshipMemory(sessionId);
        },
      });

      const dailyPath = dailyRelationshipPath(root);
      expect(fs.existsSync(dailyPath)).toBe(true);

      const content = fs.readFileSync(dailyPath, "utf-8");
      const worldMatches = content.match(/- W/g) ?? [];
      expect(worldMatches.length).toBeGreaterThan(0);
      expect(worldMatches.length).toBeLessThanOrEqual(2);
      expect(content).toContain("Canonical ordering uses SessionEnd hooks.");
      expect(content).toContain("Relationship capture no longer depends on session.idle.");
      expect(content).not.toContain("This third fact should be ignored by max-note capping.");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("no-ops when relationship or parity flags are disabled", async () => {
    const root = createTempRoot();
    const sessionId = "ses_daily_gated";
    const workDir = path.join(root, "MEMORY", "WORK", "2099-01", sessionId);
    fs.mkdirSync(workDir, { recursive: true });
    writeCurrentWorkState(root, { [sessionId]: { work_dir: workDir } });

    const thread = [
      "# THREAD",
      "",
      "**User:** I prefer concise status updates.",
      "**Assistant:** 📋 SUMMARY: Should be blocked by gating.",
    ].join("\n");
    fs.writeFileSync(path.join(workDir, "THREAD.md"), thread, "utf-8");

    try {
      await withRuntimeEnv({
        root,
        env: {
          PAI_ENABLE_MEMORY_PARITY: "0",
          PAI_ENABLE_RELATIONSHIP_MEMORY: "1",
        },
        run: async () => {
          await captureRelationshipMemory(sessionId);
        },
      });

      expect(fs.existsSync(dailyRelationshipPath(root))).toBe(false);

      await withRuntimeEnv({
        root,
        env: {
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ENABLE_RELATIONSHIP_MEMORY: "0",
        },
        run: async () => {
          await captureRelationshipMemory(sessionId);
        },
      });

      expect(fs.existsSync(dailyRelationshipPath(root))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
