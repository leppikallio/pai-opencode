import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { upsertSessionMapping } from "../../plugins/pai-cc-hooks/shared/cmux-session-map";
import { notify } from "../../plugins/pai-cc-hooks/shared/cmux-adapter";

type V2Request = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

type V2ResponseBody =
  | { ok: true; result: unknown }
  | { ok: false; error: { code?: string; message: string } };

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
  onRequest?: (request: V2Request, requestIndex: number) => V2ResponseBody;
}): Promise<{ server: net.Server; captured: V2Request[] }> {
  const captured: V2Request[] = [];
  const server = net.createServer((connection) => {
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
        captured.push(request);
        const response =
          args.onRequest?.(request, captured.length - 1) ?? { ok: true as const, result: { created: true } };
        connection.write(JSON.stringify({ id: request.id, ...response }) + "\n");
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(args.socketPath, resolve));
  return { server, captured };
}

describe("cmux adapter", () => {
  test("targets mapped surface when env surface is missing", async () => {
    const sock = path.join(os.tmpdir(), `cmux-adapter-${Date.now()}.sock`);
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-adapter-home-"));
    cleanupSocket(sock);
    const { server, captured } = await startFakeCmuxServer({ socketPath: sock });

    const previousHome = process.env.HOME;
    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.HOME = homeDir;
    process.env.CMUX_SOCKET_PATH = sock;
    delete process.env.CMUX_SURFACE_ID;

    try {
      await upsertSessionMapping({
        sessionId: "ses_123",
        workspaceId: "workspace-123",
        surfaceId: "surface-123",
      });

      await notify({
        sessionId: "ses_123",
        title: "OpenCode",
        subtitle: "Question",
        body: "Approval needed",
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].method).toBe("notification.create_for_surface");
      expect(captured[0].params).toEqual({
        surface_id: "surface-123",
        title: "OpenCode",
        subtitle: "Question",
        body: "Approval needed",
      });
    } finally {
      await closeServer(server);
      cleanupSocket(sock);
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("no-ops when CMUX_SOCKET_PATH is missing", async () => {
    const previousSocketPath = process.env.CMUX_SOCKET_PATH;

    delete process.env.CMUX_SOCKET_PATH;
    try {
      await expect(
        notify({
          sessionId: "ses_no_socket",
          title: "OpenCode",
          subtitle: "Question",
          body: "Approval needed",
        }),
      ).resolves.toBeUndefined();
    } finally {
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
    }
  });

  test("uses untargeted notification when mapping and env surface are missing", async () => {
    const sock = path.join(os.tmpdir(), `cmux-adapter-no-map-${Date.now()}.sock`);
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-adapter-home-empty-"));
    cleanupSocket(sock);
    const { server, captured } = await startFakeCmuxServer({ socketPath: sock });

    const previousHome = process.env.HOME;
    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.HOME = homeDir;
    process.env.CMUX_SOCKET_PATH = sock;
    delete process.env.CMUX_SURFACE_ID;

    try {
      await notify({
        sessionId: "ses_missing_map",
        title: "OpenCode",
        subtitle: "Session",
        body: "Background complete",
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].method).toBe("notification.create");
      expect(captured[0].params).toEqual({
        title: "OpenCode",
        subtitle: "Session",
        body: "Background complete",
      });
    } finally {
      await closeServer(server);
      cleanupSocket(sock);
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("falls back to untargeted notification when targeted create fails", async () => {
    const sock = path.join(os.tmpdir(), `cmux-adapter-fallback-${Date.now()}.sock`);
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-adapter-home-fallback-"));
    cleanupSocket(sock);
    const { server, captured } = await startFakeCmuxServer({
      socketPath: sock,
      onRequest: (request) => {
        if (request.method === "notification.create_for_surface") {
          return { ok: false, error: { code: "ENO_SURFACE", message: "surface missing" } };
        }

        return { ok: true, result: { created: true } };
      },
    });

    const previousHome = process.env.HOME;
    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.HOME = homeDir;
    process.env.CMUX_SOCKET_PATH = sock;
    delete process.env.CMUX_SURFACE_ID;

    try {
      await upsertSessionMapping({
        sessionId: "ses_surface_fail",
        workspaceId: "workspace-fail",
        surfaceId: "surface-fail",
      });

      await notify({
        sessionId: "ses_surface_fail",
        title: "OpenCode",
        subtitle: "Question",
        body: "Need fallback",
      });

      expect(captured).toHaveLength(2);
      expect(captured[0].method).toBe("notification.create_for_surface");
      expect(captured[1].method).toBe("notification.create");
      expect(captured[1].params).toEqual({
        title: "OpenCode",
        subtitle: "Question",
        body: "Need fallback",
      });
    } finally {
      await closeServer(server);
      cleanupSocket(sock);
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });
});
