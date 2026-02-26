import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  emitAmbient,
  emitInterrupt,
  resolveInterrupt,
} from "../../hooks/lib/cmux-attention";

type V2Request = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

type V2ResponseBody =
  | { ok: true; result: unknown }
  | { ok: false; error: { code?: string; message: string } };

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

function cleanupSocket(socketPath: string): void {
  try {
    fs.unlinkSync(socketPath);
  } catch {}
}

function cleanupDir(directoryPath: string): void {
  try {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  } catch {}
}

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

async function startFakeCmuxServer(args: {
  socketPath: string;
  onJsonRequest?: (request: V2Request, requestIndex: number) => V2ResponseBody;
}): Promise<{ server: net.Server; capturedJson: V2Request[]; capturedLegacy: string[] }> {
  const capturedJson: V2Request[] = [];
  const capturedLegacy: string[] = [];

  const server = net.createServer((connection) => {
    connection.setEncoding("utf8");
    let buffer = "";

    connection.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n");
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const trimmed = line.trim();

        if (!trimmed) {
          continue;
        }

        if (trimmed.startsWith("{")) {
          const request = JSON.parse(trimmed) as V2Request;
          capturedJson.push(request);
          const response =
            args.onJsonRequest?.(request, capturedJson.length - 1) ??
            ({ ok: true as const, result: { created: true } } satisfies V2ResponseBody);
          connection.write(JSON.stringify({ id: request.id, ...response }) + "\n");
          continue;
        }

        capturedLegacy.push(trimmed);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(args.socketPath, resolve));
  return { server, capturedJson, capturedLegacy };
}

describe("cmux attention emit interrupt", () => {
  test("tries target then surface then create and mirrors status/progress on fallback", async () => {
    const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-emit-"));
    const socketPath = path.join(socketDir, "cmux.sock");
    cleanupSocket(socketPath);

    const { server, capturedJson, capturedLegacy } = await startFakeCmuxServer({
      socketPath,
      onJsonRequest: (request) => {
        if (
          request.method === "notification.create_for_target" ||
          request.method === "notification.create_for_surface"
        ) {
          return { ok: false, error: { code: "NO_TARGET", message: "target missing" } };
        }

        return { ok: true, result: { created: true } };
      },
    });

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_WORKSPACE_ID = "workspace-123";
    process.env.CMUX_SURFACE_ID = "surface-123";

    try {
      await emitInterrupt({
        eventKey: "QUESTION_PENDING",
        sessionId: "ses_attention",
        reasonShort: "Need deploy approval",
      });

      await Bun.sleep(50);

      expect(capturedJson.map((entry) => entry.method).slice(0, 3)).toEqual([
        "notification.create_for_target",
        "notification.create_for_surface",
        "notification.create",
      ]);

      expect(capturedLegacy).toContain("set_status oc_attention QUESTION");
      expect(capturedLegacy).toContain("set_status oc_phase QUESTION");
      expect(capturedLegacy).toContain("set_progress 1 QUESTION");
    } finally {
      await closeServer(server);
      cleanupSocket(socketPath);
      cleanupDir(socketDir);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("mirrors legacy status/progress when all notify routes fail", async () => {
    const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-emit-none-"));
    const socketPath = path.join(socketDir, "cmux.sock");
    cleanupSocket(socketPath);

    const { server, capturedJson, capturedLegacy } = await startFakeCmuxServer({
      socketPath,
      onJsonRequest: (request) => {
        if (
          request.method === "notification.create_for_target" ||
          request.method === "notification.create_for_surface" ||
          request.method === "notification.create"
        ) {
          return { ok: false, error: { code: "NO_NOTIFY", message: "all routes unavailable" } };
        }

        return { ok: true, result: { created: true } };
      },
    });

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_WORKSPACE_ID = "workspace-123";
    process.env.CMUX_SURFACE_ID = "surface-123";

    try {
      await emitInterrupt({
        eventKey: "QUESTION_PENDING",
        sessionId: "ses_attention_none",
        reasonShort: "Need deploy approval",
      });

      await Bun.sleep(50);

      expect(capturedJson.map((entry) => entry.method).slice(0, 3)).toEqual([
        "notification.create_for_target",
        "notification.create_for_surface",
        "notification.create",
      ]);

      expect(capturedLegacy).toContain("set_status oc_attention QUESTION");
      expect(capturedLegacy).toContain("set_status oc_phase QUESTION");
      expect(capturedLegacy).toContain("set_progress 1 QUESTION");
    } finally {
      await closeServer(server);
      cleanupSocket(socketPath);
      cleanupDir(socketDir);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("no-ops when CMUX_SOCKET_PATH is missing", async () => {
    const previousSocketPath = process.env.CMUX_SOCKET_PATH;

    delete process.env.CMUX_SOCKET_PATH;
    try {
      await expect(
        emitInterrupt({
          eventKey: "QUESTION_PENDING",
          sessionId: "ses_no_socket",
          reasonShort: "Need approval",
        }),
      ).resolves.toBeUndefined();

      await expect(
        resolveInterrupt({
          eventKey: "QUESTION_RESOLVED",
          sessionId: "ses_no_socket",
          reasonShort: "Answered",
        }),
      ).resolves.toBeUndefined();

      await expect(
        emitAmbient({
          eventKey: "AGENT_COMPLETED",
          sessionId: "ses_no_socket",
          reasonShort: "Done",
        }),
      ).resolves.toBeUndefined();
    } finally {
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
    }
  });
});
