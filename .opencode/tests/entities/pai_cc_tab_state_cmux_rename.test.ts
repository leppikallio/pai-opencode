import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { setTabState } from "../../hooks/lib/tab-state";

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

describe("pai_cc_tab_state cmux rename", () => {
  test("setTabState renames the current cmux surface", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pai-tab-state-cmux-"));
    fs.mkdirSync(path.join(runtimeRoot, "hooks"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, "skills"), { recursive: true });

    const socketPath = path.join(runtimeRoot, "cmux.sock");
    cleanupSocket(socketPath);

    const capturedRequests: V2Request[] = [];
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
          capturedRequests.push(request);
          connection.write(JSON.stringify({ id: request.id, ok: true, result: {} }) + "\n");
        }
      });
    });

    await listenServer(server, socketPath);

    const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;

    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_SURFACE_ID = "surface-S1";

    try {
      await setTabState({ sessionId: "S1", title: "🧠 X", state: "thinking" });

      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]).toEqual({
        id: "1",
        method: "surface.action",
        params: {
          surface_id: "surface-S1",
          action: "rename",
          title: "🧠 X",
        },
      });
    } finally {
      await closeServer(server);
      cleanupSocket(socketPath);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
      restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
    }
  });
});
