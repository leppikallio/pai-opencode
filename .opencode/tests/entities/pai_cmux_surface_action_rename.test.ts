import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  clearSurfaceTitle,
  renameSurface,
} from "../../plugins/pai-cc-hooks/shared/cmux-adapter";

type V2Request = {
  id: string;
  method: string;
  params: Record<string, unknown>;
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

function cleanupSocket(socketPath: string): void {
  try {
    fs.unlinkSync(socketPath);
  } catch {}
}

function cleanupSocketDir(socketDir: string): void {
  try {
    fs.rmSync(socketDir, { recursive: true, force: true });
  } catch {}
}

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

async function createSocketFixture(prefix: string): Promise<{
  socketDir: string;
  socketPath: string;
}> {
  const socketDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const socketPath = path.join(socketDir, "cmux.sock");
  return { socketDir, socketPath };
}

function createCaptureServer(capturedRequests: V2Request[]): net.Server {
  return net.createServer((connection) => {
    connection.setEncoding("utf8");
    let buffer = "";

    connection.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n");
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (!line.trim()) {
          continue;
        }

        const request = JSON.parse(line) as V2Request;
        capturedRequests.push(request);
        connection.write(JSON.stringify({ id: request.id, ok: true, result: {} }) + "\n");
      }
    });
  });
}

async function listenServer(server: net.Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };

    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(socketPath);
  });
}

describe("cmux surface.action rename", () => {
  test("renameSurface sends surface.action rename payload", async () => {
    const { socketDir, socketPath } = await createSocketFixture("cmux-surface-rename");
    cleanupSocket(socketPath);

    const capturedRequests: V2Request[] = [];
    const server = createCaptureServer(capturedRequests);

    await listenServer(server, socketPath);

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_SURFACE_ID = "surface-123";

    try {
      await renameSurface({ sessionId: "ses_rename", title: "Focused Title" });

      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]?.method).toBe("surface.action");
      expect(capturedRequests[0]?.params).toEqual({
        surface_id: "surface-123",
        action: "rename",
        title: "Focused Title",
      });
    } finally {
      await closeServer(server);
      cleanupSocket(socketPath);
      cleanupSocketDir(socketDir);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("clearSurfaceTitle sends surface.action clear_name payload", async () => {
    const { socketDir, socketPath } = await createSocketFixture("cmux-surface-clear");
    cleanupSocket(socketPath);

    const capturedRequests: V2Request[] = [];
    const server = createCaptureServer(capturedRequests);

    await listenServer(server, socketPath);

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_SURFACE_ID = "surface-456";

    try {
      await clearSurfaceTitle({ sessionId: "ses_clear" });

      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]?.method).toBe("surface.action");
      expect(capturedRequests[0]?.params).toEqual({
        surface_id: "surface-456",
        action: "clear_name",
      });
    } finally {
      await closeServer(server);
      cleanupSocket(socketPath);
      cleanupSocketDir(socketDir);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });
});
