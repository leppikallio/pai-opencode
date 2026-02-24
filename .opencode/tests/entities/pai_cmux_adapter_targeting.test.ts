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

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("cmux adapter", () => {
  test("targets mapped surface when env surface is missing", async () => {
    const sock = path.join(os.tmpdir(), `cmux-adapter-${Date.now()}.sock`);
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-adapter-home-"));
    const captured: V2Request[] = [];

    try {
      fs.unlinkSync(sock);
    } catch {}

    const server = net.createServer((connection) => {
      connection.setEncoding("utf8");
      let buffer = "";

      connection.on("data", (chunk) => {
        buffer += chunk;
        if (!buffer.includes("\n")) {
          return;
        }

        const line = buffer.split("\n")[0];
        const request = JSON.parse(line) as V2Request;
        captured.push(request);

        connection.write(JSON.stringify({ id: request.id, ok: true, result: { created: true } }) + "\n");
      });
    });

    await new Promise<void>((resolve) => server.listen(sock, resolve));

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
      try {
        fs.unlinkSync(sock);
      } catch {}

      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      if (previousSocketPath === undefined) {
        delete process.env.CMUX_SOCKET_PATH;
      } else {
        process.env.CMUX_SOCKET_PATH = previousSocketPath;
      }

      if (previousSurfaceId === undefined) {
        delete process.env.CMUX_SURFACE_ID;
      } else {
        process.env.CMUX_SURFACE_ID = previousSurfaceId;
      }
    }
  });
});
