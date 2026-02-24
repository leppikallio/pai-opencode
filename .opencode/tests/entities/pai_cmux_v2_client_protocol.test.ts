import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

import { CmuxV2Client } from "../../plugins/pai-cc-hooks/shared/cmux-v2-client";

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("CmuxV2Client", () => {
  test("sends one-line JSON and parses one-line JSON response", async () => {
    const sock = path.join(os.tmpdir(), `cmux-${Date.now()}.sock`);
    try { fs.unlinkSync(sock); } catch {}

    const server = net.createServer((c) => {
      c.setEncoding("utf8");
      let buf = "";
      c.on("data", (d) => {
        buf += d;
        if (!buf.includes("\n")) return;
        const line = buf.split("\n")[0];
        const req = JSON.parse(line);
        c.write(JSON.stringify({ id: req.id, ok: true, result: { pong: true } }) + "\n");
      });
    });
    await new Promise<void>((res) => server.listen(sock, res));

    try {
      const client = new CmuxV2Client({ socketPath: sock });
      const result = await client.call("system.ping", {});
      expect(result).toEqual({ pong: true });
    } finally {
      await closeServer(server);
      try { fs.unlinkSync(sock); } catch {}
    }
  });

  test("times out when server never replies", async () => {
    const sock = path.join(os.tmpdir(), `cmux-timeout-${Date.now()}.sock`);
    try { fs.unlinkSync(sock); } catch {}

    const server = net.createServer((c) => {
      c.setEncoding("utf8");
      c.on("data", () => {
        // hold connection open and do not reply
      });
    });
    await new Promise<void>((res) => server.listen(sock, res));

    try {
      const client = new CmuxV2Client({ socketPath: sock, timeoutMs: 50 });
      await expect(client.call("system.hang", {})).rejects.toMatchObject({ code: "ETIMEDOUT" });
    } finally {
      await closeServer(server);
      try { fs.unlinkSync(sock); } catch {}
    }
  });

  test("throws server error payload with context", async () => {
    const sock = path.join(os.tmpdir(), `cmux-error-${Date.now()}.sock`);
    try { fs.unlinkSync(sock); } catch {}

    const server = net.createServer((c) => {
      c.setEncoding("utf8");
      c.on("data", (d) => {
        const line = d.toString().split("\n")[0];
        const req = JSON.parse(line);
        c.write(JSON.stringify({ id: req.id, ok: false, error: { code: "EFAIL", message: "boom" } }) + "\n");
      });
    });
    await new Promise<void>((res) => server.listen(sock, res));

    try {
      const client = new CmuxV2Client({ socketPath: sock });
      try {
        await client.call("system.fail", {});
        throw new Error("expected call to throw");
      } catch (error) {
        const err = error as Error & { code?: string };
        expect(err.code).toBe("EFAIL");
        expect(err.message).toContain("system.fail");
        expect(err.message).toContain(sock);
        expect(err.message).toContain("boom");
      }
    } finally {
      await closeServer(server);
      try { fs.unlinkSync(sock); } catch {}
    }
  });
});
