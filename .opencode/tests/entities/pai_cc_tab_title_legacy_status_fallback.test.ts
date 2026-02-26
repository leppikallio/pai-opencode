import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { renameCurrentCmuxSurfaceTitle } from "../../hooks/lib/cmux-v2";

type V2Request = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
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

describe("cmux title legacy fallback", () => {
  test("falls back to set_status when rename actions are unavailable", async () => {
    const socketDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cmux-title-fallback-"));
    const socketPath = path.join(socketDir, "cmux.sock");
    cleanupSocket(socketPath);

    const capturedV2Requests: V2Request[] = [];
    const capturedV1Commands: string[] = [];

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
            capturedV2Requests.push(request);

            if (request.method === "surface.action" || request.method === "tab.action") {
              connection.write(
                JSON.stringify({
                  id: request.id,
                  ok: false,
                  error: {
                    code: "method_not_found",
                    message: "Unknown method",
                  },
                }) + "\n",
              );
              continue;
            }

            connection.write(JSON.stringify({ id: request.id, ok: true, result: {} }) + "\n");
            continue;
          }

          capturedV1Commands.push(line);
          connection.write("OK\n");
        }
      });
    });

    await listenServer(server, socketPath);

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;

    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_SURFACE_ID = "surface-legacy";
    process.env.CMUX_WORKSPACE_ID = "workspace-legacy";

    try {
      await renameCurrentCmuxSurfaceTitle("🧠 Legacy Title");

      expect(capturedV2Requests).toHaveLength(2);
      expect(capturedV2Requests[0]?.method).toBe("surface.action");
      expect(capturedV2Requests[1]?.method).toBe("tab.action");

      expect(capturedV1Commands).toEqual([
        'set_status opencode_tab_title "THINK: Legacy Title" --icon=brain.head.profile --color=#4C8DFF --tab=workspace-legacy',
        'set_progress 0.2 --label="THINK" --tab=workspace-legacy',
      ]);
    } finally {
      await closeServer(server);
      cleanupSocket(socketPath);
      cleanupSocketDir(socketDir);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
    }
  });
});
