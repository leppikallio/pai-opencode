import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createHistoryCapture } from "../../plugins/handlers/history-capture";

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readCurrentWorkDir(root: string, sessionId: string): Promise<string | null> {
  const currentWorkPath = path.join(root, "MEMORY", "STATE", "current-work.json");
  try {
    const raw = await fs.readFile(currentWorkPath, "utf8");
    const parsed = JSON.parse(raw) as {
      sessions?: Record<string, { work_dir?: string }>;
    };
    const workDir = parsed.sessions?.[sessionId]?.work_dir;
    return typeof workDir === "string" && workDir.length > 0 ? workDir : null;
  } catch {
    return null;
  }
}

async function findRawSessionFile(root: string, sessionId: string): Promise<string | null> {
  const rawRoot = path.join(root, "MEMORY", "RAW");
  if (!(await exists(rawRoot))) {
    return null;
  }

  const monthDirs = await fs.readdir(rawRoot, { withFileTypes: true });
  for (const monthDir of monthDirs) {
    if (!monthDir.isDirectory()) continue;
    const candidate = path.join(rawRoot, monthDir.name, `${sessionId}.jsonl`);
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function withEnv(overrides: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("PAI hint runtime consumer contract", () => {
  test("history-capture consumes canonical advisory envelope and persists provenance", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pai-hint-runtime-consumer-"));
    const sessionId = "session-hint-runtime-consumer";
    const messageId = `message-${Date.now()}`;

    try {
      await withEnv(
        {
          OPENCODE_ROOT: root,
          PAI_ENABLE_MEMORY_PARITY: "1",
          PAI_ENABLE_CARRIER_PROMPT_HINTS: "0",
          PAI_PROMPT_HINT_CARRIER_MODE: "disabled",
          PAI_ENABLE_AUTO_PRD: "1",
          PAI_ENABLE_AUTO_PRD_PROMPT_CLASSIFICATION: "1",
        },
        async () => {
          const capture = createHistoryCapture({ directory: root });

          await capture.handleEvent({
            type: "message.updated",
            properties: {
              info: {
                id: messageId,
                sessionID: sessionId,
                role: "user",
              },
            },
          });

          await capture.handleEvent({
            type: "message.part.updated",
            properties: {
              part: {
                sessionID: sessionId,
                messageID: messageId,
                type: "text",
                text: "Please continue this migration via @general with deterministic checks.",
              },
            },
          });

          const consumed = capture.consumePromptHint(sessionId);
          expect(consumed?.kind).toBe("pai.advisory_hint");
          expect(consumed?.advisory.capabilities.length).toBeGreaterThan(0);
          expect(capture.consumePromptHint(sessionId)).toBeUndefined();
        },
      );

      const workDir = await readCurrentWorkDir(root, sessionId);
      expect(typeof workDir).toBe("string");
      if (!workDir) {
        throw new Error("expected work dir from history-capture prompt hint flow");
      }

      const promptHintsPath = path.join(workDir, "PROMPT_HINTS.jsonl");
      expect(await exists(promptHintsPath)).toBe(true);
      const hintsLines = (await fs.readFile(promptHintsPath, "utf8"))
        .split("\n")
        .filter((line) => line.trim().length > 0);
      expect(hintsLines.length).toBeGreaterThan(0);

      const parsedHint = JSON.parse(hintsLines[0] ?? "{}") as {
        kind?: string;
        advisory?: { depth?: string };
        provenance?: unknown[];
      };
      expect(parsedHint.kind).toBe("pai.advisory_hint");
      expect(typeof parsedHint.advisory?.depth).toBe("string");
      expect(Array.isArray(parsedHint.provenance)).toBe(true);

      const rawFile = await findRawSessionFile(root, sessionId);
      expect(typeof rawFile).toBe("string");
      if (!rawFile) {
        throw new Error("expected RAW file for prompt hint runtime consumer contract");
      }

      const rawLines = (await fs.readFile(rawFile, "utf8"))
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { name?: string; payload?: Record<string, unknown> });
      const promptHintEvent = rawLines.find((line) => line.name === "prompt.hint");
      expect(promptHintEvent).toBeTruthy();

      const payload = promptHintEvent?.payload ?? {};
      const routing = payload.routing_precedence as
        | { precedence?: string; hasExplicitRoutingCue?: boolean }
        | undefined;
      expect(payload.selected_producer).toBe("runtime_heuristic");
      expect(routing?.precedence).toBe("explicit_routing");
      expect(routing?.hasExplicitRoutingCue).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
