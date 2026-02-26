import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { emitInterrupt } from "../../hooks/lib/cmux-attention";

type V2Request = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

type V2ResponseBody =
  | { ok: true; result: unknown }
  | { ok: false; error: { code?: string; message: string } };

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

function cleanupPath(targetPath: string): void {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // Best effort only.
  }
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

async function startFakeCmuxServer(args: {
  socketPath: string;
  onJsonRequest?: (request: V2Request) => V2ResponseBody;
}): Promise<{ server: net.Server; capturedJson: V2Request[]; capturedLegacy: string[] }> {
  const capturedJson: V2Request[] = [];
  const capturedLegacy: string[] = [];

  const server = net.createServer((connection) => {
    connection.setEncoding("utf8");
    let buffer = "";

    connection.on("data", (chunk) => {
      buffer += chunk;

      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n");
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const trimmed = line.trim();

        if (!trimmed) {
          continue;
        }

        if (trimmed.startsWith("{")) {
          const request = JSON.parse(trimmed) as V2Request;
          capturedJson.push(request);

          const response =
            args.onJsonRequest?.(request) ??
            ({ ok: true as const, result: { created: true } } satisfies V2ResponseBody);
          connection.write(JSON.stringify({ id: request.id, ...response }) + "\n");
          continue;
        }

        capturedLegacy.push(trimmed);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(args.socketPath, resolve));
  return { server, capturedJson, capturedLegacy };
}

describe("cmux attention feature flags", () => {
  test("PAI_CMUX_ATTENTION_ENABLED=0 disables attention emissions", async () => {
    const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-flags-attention-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-flags-runtime-"));
    const socketPath = path.join(socketDir, "cmux.sock");

    const { server, capturedJson, capturedLegacy } = await startFakeCmuxServer({ socketPath });

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousAttentionEnabled = process.env.PAI_CMUX_ATTENTION_ENABLED;

    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_WORKSPACE_ID = "workspace-flags";
    process.env.CMUX_SURFACE_ID = "surface-flags";
    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_ATTENTION_ENABLED = "0";

    try {
      await emitInterrupt({
        eventKey: "QUESTION_PENDING",
        sessionId: "ses_flags_attention_disabled",
        reasonShort: "Need deploy approval",
      });

      await Bun.sleep(50);

      expect(capturedJson).toHaveLength(0);
      expect(capturedLegacy).toHaveLength(0);
    } finally {
      await closeServer(server);
      cleanupPath(socketDir);
      cleanupPath(runtimeRoot);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_ATTENTION_ENABLED", previousAttentionEnabled);
    }
  });

  test("PAI_CMUX_PROGRESS_ENABLED=0 disables progress mirror only", async () => {
    const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-flags-progress-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-flags-runtime-"));
    const socketPath = path.join(socketDir, "cmux.sock");

    const { server, capturedJson, capturedLegacy } = await startFakeCmuxServer({
      socketPath,
      onJsonRequest: (request) => {
        if (
          request.method === "notification.create_for_target" ||
          request.method === "notification.create_for_surface"
        ) {
          return { ok: false, error: { code: "NO_TARGET", message: "target missing" } };
        }

        return { ok: true, result: { created: true } };
      },
    });

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousProgressEnabled = process.env.PAI_CMUX_PROGRESS_ENABLED;

    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_WORKSPACE_ID = "workspace-flags";
    process.env.CMUX_SURFACE_ID = "surface-flags";
    process.env.OPENCODE_ROOT = runtimeRoot;
    process.env.PAI_CMUX_PROGRESS_ENABLED = "0";

    try {
      await emitInterrupt({
        eventKey: "QUESTION_PENDING",
        sessionId: "ses_flags_progress_disabled",
        reasonShort: "Need deploy approval",
      });

      await Bun.sleep(50);

      expect(capturedJson.map((entry) => entry.method).slice(0, 3)).toEqual([
        "notification.create_for_target",
        "notification.create_for_surface",
        "notification.create",
      ]);

      expect(capturedLegacy).toContain("set_status oc_attention QUESTION");
      expect(capturedLegacy).toContain("set_status oc_phase QUESTION");
      expect(capturedLegacy.some((line) => line.startsWith("set_progress "))).toBe(false);
    } finally {
      await closeServer(server);
      cleanupPath(socketDir);
      cleanupPath(runtimeRoot);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_PROGRESS_ENABLED", previousProgressEnabled);
    }
  });

  test("PAI_CMUX_FLASH_ON_P0=0 disables flash nudges", async () => {
    const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-flags-flash-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-attention-flags-runtime-"));
    const socketPath = path.join(socketDir, "cmux.sock");

    const { server, capturedJson } = await startFakeCmuxServer({ socketPath });

    const previousSocketPath = process.env.CMUX_SOCKET_PATH;
    const previousWorkspaceId = process.env.CMUX_WORKSPACE_ID;
    const previousSurfaceId = process.env.CMUX_SURFACE_ID;
    const previousOpencodeRoot = process.env.OPENCODE_ROOT;
    const previousFlashOnP0 = process.env.PAI_CMUX_FLASH_ON_P0;

    process.env.CMUX_SOCKET_PATH = socketPath;
    process.env.CMUX_WORKSPACE_ID = "workspace-flags";
    process.env.CMUX_SURFACE_ID = "surface-flags";
    process.env.OPENCODE_ROOT = runtimeRoot;

    try {
      delete process.env.PAI_CMUX_FLASH_ON_P0;
      await emitInterrupt({
        eventKey: "QUESTION_PENDING",
        sessionId: "ses_flags_flash_default",
        reasonShort: "Need deploy approval",
      });

      process.env.PAI_CMUX_FLASH_ON_P0 = "0";
      await emitInterrupt({
        eventKey: "PERMISSION_PENDING",
        sessionId: "ses_flags_flash_disabled",
        reasonShort: "Need permission",
      });

      await Bun.sleep(50);

      const flashCalls = capturedJson.filter((entry) => entry.method === "surface.trigger_flash");
      expect(flashCalls).toHaveLength(1);
    } finally {
      await closeServer(server);
      cleanupPath(socketDir);
      cleanupPath(runtimeRoot);
      restoreEnv("CMUX_SOCKET_PATH", previousSocketPath);
      restoreEnv("CMUX_WORKSPACE_ID", previousWorkspaceId);
      restoreEnv("CMUX_SURFACE_ID", previousSurfaceId);
      restoreEnv("OPENCODE_ROOT", previousOpencodeRoot);
      restoreEnv("PAI_CMUX_FLASH_ON_P0", previousFlashOnP0);
    }
  });
});
