import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function withEnv(
  name: string,
  value: string | undefined,
  run: () => Promise<void> | void
): Promise<void> {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    await run();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(25);
  }
  return false;
}

function writeCurrentWorkState(root: string, sessionId: string, workDir: string) {
  const stateDir = path.join(root, "MEMORY", "STATE");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "current-work.json"),
    `${JSON.stringify(
      {
        v: "0.2",
        updated_at: new Date().toISOString(),
        sessions: {
          [sessionId]: { work_dir: workDir },
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFilesRecursive(full)));
    else out.push(full);
  }
  return out;
}

async function setupRoot(sessionId: string): Promise<{ root: string; workDir: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pai-soft-finalize-"));
  const ym = "2099-01";
  const workDir = path.join(root, "MEMORY", "WORK", ym, sessionId);
  fs.mkdirSync(workDir, { recursive: true });

  writeCurrentWorkState(root, sessionId, workDir);

  // scheduleSoftFinalize() pauses the session (updates META.yaml) and appends to THREAD.md.
  fs.writeFileSync(path.join(workDir, "META.yaml"), "status: ACTIVE\n", "utf8");

  // Ensure extractLearningsFromWork has deterministic content it can persist.
  fs.writeFileSync(
    path.join(workDir, "ISC.json"),
    `${JSON.stringify({ criteria: [{ text: "Something", status: "DONE" }] }, null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(path.join(workDir, "THREAD.md"), "**User:** hi\n", "utf8");

  return { root, workDir };
}

describe("soft finalize fine-grain learnings gate", () => {
  test("does not extract learnings when fine-grain flag is disabled", async () => {
    const sessionId = "ses_soft_finalize_off";
    const { root, workDir } = await setupRoot(sessionId);

    const prevRoot = process.env.OPENCODE_ROOT;
    process.env.OPENCODE_ROOT = root;

    try {
      await withEnv("PAI_SOFT_FINALIZE_MS", "1", async () => {
        await withEnv("PAI_ENABLE_FINE_GRAIN_LEARNINGS", undefined, async () => {
          const { createHistoryCapture } = await import("../../plugins/handlers/history-capture");
          const cap = createHistoryCapture({ serverUrl: "http://localhost:4096", directory: root });
          await cap.handleEvent({ type: "session.idle", properties: { sessionID: sessionId } });

          // Ensure the soft-finalize timer actually ran.
          const metaPath = path.join(workDir, "META.yaml");
          const paused = await waitFor(async () => {
            const meta = await fs.promises.readFile(metaPath, "utf8");
            return meta.includes("status: PAUSED");
          }, 1000);
          expect(paused).toBe(true);

          const learningDir = path.join(root, "MEMORY", "LEARNING");
          const exists = fs.existsSync(learningDir);
          if (!exists) {
            expect(exists).toBe(false);
            return;
          }

          const files = await listFilesRecursive(learningDir);
          expect(files.filter((f) => f.endsWith(".md"))).toHaveLength(0);
        });
      });
    } finally {
      if (prevRoot === undefined) delete process.env.OPENCODE_ROOT;
      else process.env.OPENCODE_ROOT = prevRoot;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("extracts learnings when fine-grain flag is enabled", async () => {
    const sessionId = "ses_soft_finalize_on";
    const { root, workDir } = await setupRoot(sessionId);

    const prevRoot = process.env.OPENCODE_ROOT;
    process.env.OPENCODE_ROOT = root;

    try {
      await withEnv("PAI_SOFT_FINALIZE_MS", "1", async () => {
        await withEnv("PAI_ENABLE_FINE_GRAIN_LEARNINGS", "1", async () => {
          const { createHistoryCapture } = await import("../../plugins/handlers/history-capture");
          const cap = createHistoryCapture({ serverUrl: "http://localhost:4096", directory: root });
          await cap.handleEvent({ type: "session.idle", properties: { sessionID: sessionId } });

          const metaPath = path.join(workDir, "META.yaml");
          const paused = await waitFor(async () => {
            const meta = await fs.promises.readFile(metaPath, "utf8");
            return meta.includes("status: PAUSED");
          }, 1000);
          expect(paused).toBe(true);

          const learningDir = path.join(root, "MEMORY", "LEARNING");
          const wrote = await waitFor(async () => {
            if (!fs.existsSync(learningDir)) return false;
            const files = await listFilesRecursive(learningDir);
            return files.some((f) => f.endsWith(".md"));
          }, 1000);
          expect(wrote).toBe(true);
        });
      });
    } finally {
      if (prevRoot === undefined) delete process.env.OPENCODE_ROOT;
      else process.env.OPENCODE_ROOT = prevRoot;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
