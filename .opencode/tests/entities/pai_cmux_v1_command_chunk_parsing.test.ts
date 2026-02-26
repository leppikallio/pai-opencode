import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { mirrorCurrentCmuxPhase } from "../../hooks/lib/cmux-v2";

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

describe("cmux v1 command chunk parsing", () => {
  test("handles split response lines and triggers workspace fallback", async () => {
    const socketDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cmux-v1-chunks-"));
    const socketPath = path.join(socketDir, "cmux.sock");

    const capturedCommands: string[] = [];
    const server = net.createServer((connection) => {
      connection.setEncoding("utf8");
      let buffer = "";

      connection.on("data", (chunk) => {
        buffer += chunk;

        while (buffer.includes("\n")) {
          const newlineIndex = buffer.indexOf("\n");
          const command = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!command) {
            continue;
          }

          capturedCommands.push(command);

          if (command.includes("--tab=")) {
            connection.write("ERROR: workspace ");
            connection.write("not found\n");
            continue;
          }

          connection.write("O");
          connection.write("K\n");
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;

    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_WORKSPACE_ID = "workspace-missing";

    try {
      await expect(mirrorCurrentCmuxPhase({ phaseToken: "THINK" })).resolves.toBeUndefined();

      expect(capturedCommands).toHaveLength(4);
      expect(capturedCommands[0]).toContain("set_status oc_phase THINK --tab=workspace-missing");
      expect(capturedCommands[1]).toBe("set_status oc_phase THINK");
      expect(capturedCommands[2]).toContain("set_progress 0.2 --label=\"THINK\" --tab=workspace-missing");
      expect(capturedCommands[3]).toBe("set_progress 0.2 --label=\"THINK\"");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      fs.rmSync(socketDir, { recursive: true, force: true });
    }
  });
});
