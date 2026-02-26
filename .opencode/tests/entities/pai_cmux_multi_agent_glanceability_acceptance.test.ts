import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { emitAmbient, emitInterrupt } from "../../hooks/lib/cmux-attention";
import { normalizeReasonShort } from "../../hooks/lib/cmux-attention-types";

type V2Request = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

type LogicalSession = {
  sessionId: string;
  state: "running" | "question" | "blocked" | "failed" | "completed";
  eventKey?: "QUESTION_PENDING" | "AGENT_BLOCKED" | "AGENT_FAILED" | "AGENT_COMPLETED";
  reasonShort?: string;
};

async function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function cleanupPath(targetPath: string): void {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // Best effort only.
  }
}

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

async function startFakeCmuxServer(socketPath: string): Promise<{
  server: net.Server;
  capturedJson: V2Request[];
  capturedLegacy: string[];
}> {
  const capturedJson: V2Request[] = [];
  const capturedLegacy: string[] = [];

  const server = net.createServer((connection) => {
    connection.setEncoding("utf8");
    let buffer = "";

    connection.on("data", (chunk) => {
      buffer += chunk;

      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n");
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) {
          continue;
        }

        if (line.startsWith("{")) {
          const request = JSON.parse(line) as V2Request;
          capturedJson.push(request);
          connection.write(JSON.stringify({ id: request.id, ok: true, result: { created: true } }) + "\n");
          continue;
        }

        capturedLegacy.push(line);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return { server, capturedJson, capturedLegacy };
}

function readSubtitle(request: V2Request): string {
  const subtitle = request.params.subtitle;
  return typeof subtitle === "string" ? subtitle : "";
}

function readBody(request: V2Request): string {
  const body = request.params.body;
  return typeof body === "string" ? body : "";
}

describe("cmux multi-agent glanceability acceptance", () => {
  test("keeps unresolved interrupts pending, trims reason, suppresses duplicate bursts, and mirrors active workspace", async () => {
    const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-acceptance-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-runtime-"));
    const socketPath = path.join(socketDir, "cmux.sock");

    const { server, capturedJson, capturedLegacy } = await startFakeCmuxServer(socketPath);

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousFlashOnP0 = process.env.PAI_CMUX_FLASH_ON_P0;

    const duplicateQuestionReason = "Need deploy approval for release";
    const duplicateCompletionReason = "Done: bundle docs";
    const longQuestionReason =
      "Need approval after full release candidate checks and smoke tests";

    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_WORKSPACE_ID = "workspace-acceptance";
    process.env.CMUX_SURFACE_ID = "surface-acceptance";
    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_FLASH_ON_P0 = "0";

    const logicalSessions: LogicalSession[] = [
      { sessionId: "ses-running-1", state: "running" },
      { sessionId: "ses-running-2", state: "running" },
      { sessionId: "ses-running-3", state: "running" },
      {
        sessionId: "ses-question-1",
        state: "question",
        eventKey: "QUESTION_PENDING",
        reasonShort: duplicateQuestionReason,
      },
      {
        sessionId: "ses-question-2",
        state: "question",
        eventKey: "QUESTION_PENDING",
        reasonShort: longQuestionReason,
      },
      {
        sessionId: "ses-blocked-1",
        state: "blocked",
        eventKey: "AGENT_BLOCKED",
        reasonShort: "Waiting for lock",
      },
      {
        sessionId: "ses-failed-1",
        state: "failed",
        eventKey: "AGENT_FAILED",
        reasonShort: "Tests failed",
      },
      {
        sessionId: "ses-completed-1",
        state: "completed",
        eventKey: "AGENT_COMPLETED",
        reasonShort: duplicateCompletionReason,
      },
      {
        sessionId: "ses-completed-2",
        state: "completed",
        eventKey: "AGENT_COMPLETED",
        reasonShort: "Done: build package",
      },
      {
        sessionId: "ses-completed-3",
        state: "completed",
        eventKey: "AGENT_COMPLETED",
        reasonShort: "Done: sync docs",
      },
    ];

    try {
      for (const session of logicalSessions) {
        if (session.state === "running") {
          continue;
        }

        if (session.eventKey === "AGENT_COMPLETED") {
          await emitAmbient({
            eventKey: session.eventKey,
            sessionId: session.sessionId,
            reasonShort: session.reasonShort,
          });
          continue;
        }

        await emitInterrupt({
          eventKey: session.eventKey!,
          sessionId: session.sessionId,
          reasonShort: session.reasonShort,
        });
      }

      await emitInterrupt({
        eventKey: "QUESTION_PENDING",
        sessionId: "ses-question-1",
        reasonShort: duplicateQuestionReason,
      });

      await emitAmbient({
        eventKey: "AGENT_COMPLETED",
        sessionId: "ses-completed-1",
        reasonShort: duplicateCompletionReason,
      });

      await Bun.sleep(50);

      const targetedNotifications = capturedJson.filter(
        (request) => request.method === "notification.create_for_target",
      );

      expect(targetedNotifications).toHaveLength(7);

      for (const request of targetedNotifications) {
        expect(request.params.workspace_id).toBe("workspace-acceptance");
        expect(request.params.surface_id).toBe("surface-acceptance");
      }

      const unresolvedExpected = logicalSessions.filter((session) => {
        return (
          session.state === "question" || session.state === "blocked" || session.state === "failed"
        );
      }).length;

      const unresolvedNotifications = targetedNotifications.filter((request) => {
        const subtitle = readSubtitle(request);
        return subtitle.endsWith("P0") || subtitle.endsWith("P1");
      });

      expect(unresolvedNotifications).toHaveLength(unresolvedExpected);

      for (const request of unresolvedNotifications) {
        const body = readBody(request);
        expect(body.length).toBeGreaterThan(0);
        expect(body.length).toBeLessThanOrEqual(60);
      }

      expect(
        unresolvedNotifications.some((request) => readBody(request) === normalizeReasonShort(longQuestionReason)),
      ).toBe(true);

      const duplicateQuestionCount = targetedNotifications.filter((request) => {
        return readSubtitle(request) === "Question P0" && readBody(request) === duplicateQuestionReason;
      }).length;

      expect(duplicateQuestionCount).toBe(1);

      const duplicateCompletionCount = targetedNotifications.filter((request) => {
        return readSubtitle(request) === "Completed P2" && readBody(request) === duplicateCompletionReason;
      }).length;

      expect(duplicateCompletionCount).toBe(1);

      expect(capturedLegacy.some((line) => line.startsWith("set_status oc_attention "))).toBe(true);
      expect(capturedLegacy.some((line) => line.startsWith("set_status oc_phase "))).toBe(true);
      expect(capturedLegacy.some((line) => line.startsWith("set_progress "))).toBe(true);

      expect(capturedLegacy.includes("clear_status oc_attention")).toBe(false);
      expect(capturedLegacy.includes("clear_progress")).toBe(false);
    } finally {
      await closeServer(server);
      cleanupPath(socketDir);
      cleanupPath(runtimeRoot);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_FLASH_ON_P0", previousFlashOnP0);
    }
  });
});
