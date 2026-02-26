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

type V2Response =
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

function createCaptureServer(args: {
  capturedRequests: V2Request[];
  responder?: (request: V2Request) => V2Response;
}): net.Server {
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
        args.capturedRequests.push(request);
        const response = args.responder?.(request) ?? { ok: true, result: {} };
        connection.write(`${JSON.stringify({ id: request.id, ...response })}\n`);
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
    const server = createCaptureServer({ capturedRequests });

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
    const server = createCaptureServer({ capturedRequests });

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

  test("renameSurface falls back to tab.action when surface.action is unsupported", async () => {
    const { socketDir, socketPath } = await createSocketFixture("cmux-surface-rename-fallback");
    cleanupSocket(socketPath);

    const capturedRequests: V2Request[] = [];
    const server = createCaptureServer({
      capturedRequests,
      responder: (request) => {
        if (request.method === "surface.action") {
          return {
            ok: false,
            error: {
              code: "method_not_found",
              message: "Unknown method",
            },
          };
        }

        return { ok: true, result: {} };
      },
    });

    await listenServer(server, socketPath);

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_SURFACE_ID = "surface-789";

    try {
      await renameSurface({ sessionId: "ses_rename_fallback", title: "Fallback Title" });

      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests[0]?.method).toBe("surface.action");
      expect(capturedRequests[1]?.method).toBe("tab.action");
      expect(capturedRequests[1]?.params).toEqual({
        tab_id: "surface-789",
        action: "rename",
        title: "Fallback Title",
      });
    } finally {
      await closeServer(server);
      cleanupSocket(socketPath);
      cleanupSocketDir(socketDir);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("clearSurfaceTitle falls back to tab.action when surface.action is unsupported", async () => {
    const { socketDir, socketPath } = await createSocketFixture("cmux-surface-clear-fallback");
    cleanupSocket(socketPath);

    const capturedRequests: V2Request[] = [];
    const server = createCaptureServer({
      capturedRequests,
      responder: (request) => {
        if (request.method === "surface.action") {
          return {
            ok: false,
            error: {
              code: "method_not_found",
              message: "Unknown method",
            },
          };
        }

        return { ok: true, result: {} };
      },
    });

    await listenServer(server, socketPath);

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_SURFACE_ID = "surface-790";

    try {
      await clearSurfaceTitle({ sessionId: "ses_clear_fallback" });

      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests[0]?.method).toBe("surface.action");
      expect(capturedRequests[1]?.method).toBe("tab.action");
      expect(capturedRequests[1]?.params).toEqual({
        tab_id: "surface-790",
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
