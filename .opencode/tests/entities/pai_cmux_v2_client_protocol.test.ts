import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

import { CmuxV2Client } from "../../plugins/pai-cc-hooks/shared/cmux-v2-client";

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

    const client = new CmuxV2Client({ socketPath: sock });
    const result = await client.call("system.ping", {});
    expect(result).toEqual({ pong: true });

    server.close();
  });
});
