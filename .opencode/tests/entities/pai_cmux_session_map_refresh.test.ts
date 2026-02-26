import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { notifyTargeted } from "../../plugins/pai-cc-hooks/shared/cmux-adapter";
import {
  lookupSessionMapping,
  syncSessionMappingFromEnv,
  upsertSessionMapping,
} from "../../plugins/pai-cc-hooks/shared/cmux-session-map";

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

describe("cmux session map refresh", () => {
  test("syncSessionMappingFromEnv upserts from CMUX env ids", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-session-refresh-home-"));
    const previousHome = process.env.HOME;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.HOME = homeDir;
    process.env.CMUX_WORKSPACE_ID = "workspace-env";
    process.env.CMUX_SURFACE_ID = "surface-env";

    try {
      await syncSessionMappingFromEnv("ses_env_sync", "/tmp/project-env");

      const mapping = await lookupSessionMapping({ sessionId: "ses_env_sync" });
      expect(mapping?.workspaceId).toBe("workspace-env");
      expect(mapping?.surfaceId).toBe("surface-env");
      expect(mapping?.cwd).toBe("/tmp/project-env");
    } finally {
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });

  test("targeted notify falls back and next event uses refreshed mapping", async () => {
    const sock = path.join(os.tmpdir(), `cmux-session-refresh-${Date.now()}.sock`);
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-session-refresh-home-"));
    cleanupSocket(sock);

    let targetFailures = 0;
    const { server, captured } = await startFakeCmuxServer({
      socketPath: sock,
      onRequest: (request) => {
        if (request.method === "notification.create_for_target" && targetFailures === 0) {
          targetFailures += 1;
          return { ok: false, error: { code: "STALE_TARGET", message: "target missing" } };
        }

        return { ok: true, result: { created: true } };
      },
    });

    const previousHome = process.env.HOME;
    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.HOME = homeDir;
    process.env.CMUX_SOCKET_PATH = sock;
    process.env.CMUX_WORKSPACE_ID = "workspace-fresh";
    process.env.CMUX_SURFACE_ID = "surface-fresh";

    try {
      await upsertSessionMapping({
        sessionId: "ses_refresh",
        workspaceId: "workspace-stale",
        surfaceId: "surface-stale",
      });

      const firstRoute = await notifyTargeted({
        sessionId: "ses_refresh",
        title: "PAI",
        subtitle: "Question",
        body: "Need approval",
      });
      expect(firstRoute).toBe("notification.create_for_surface");

      const refreshed = await lookupSessionMapping({ sessionId: "ses_refresh" });
      expect(refreshed?.workspaceId).toBe("workspace-fresh");
      expect(refreshed?.surfaceId).toBe("surface-fresh");

      delete process.env.CMUX_WORKSPACE_ID;
      delete process.env.CMUX_SURFACE_ID;

      const secondRoute = await notifyTargeted({
        sessionId: "ses_refresh",
        title: "PAI",
        subtitle: "Question",
        body: "Need follow-up",
      });
      expect(secondRoute).toBe("notification.create_for_target");

      expect(captured.map((entry) => entry.method)).toEqual([
        "notification.create_for_target",
        "notification.create_for_surface",
        "notification.create_for_target",
      ]);
      expect(captured[0].params).toMatchObject({
        workspace_id: "workspace-fresh",
        surface_id: "surface-fresh",
      });
      expect(captured[2].params).toMatchObject({
        workspace_id: "workspace-fresh",
        surface_id: "surface-fresh",
      });
    } finally {
      await closeServer(server);
      cleanupSocket(sock);
      cleanupDir(homeDir);
      restoreEnv("HOME", previousHome);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });
});
