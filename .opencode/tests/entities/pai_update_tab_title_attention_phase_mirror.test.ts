import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

type V2Request = {
  id: string;
  method: string;
  params: Record<string, unknown>;
};

function withEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
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

function tabStatePath(runtimeRoot: string, sessionId: string): string {
  return path.join(runtimeRoot, "MEMORY", "STATE", `tab-state-${sessionId}.json`);
}

async function makeRuntimeRoot(prefix: string): Promise<string> {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(runtimeRoot, "hooks"), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, "skills"), { recursive: true });
  return runtimeRoot;
}

async function runUpdateTabTitleHook(args: {
  runtimeRoot: string;
  socketPath: string;
  payload: Record<string, unknown>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", ".opencode/hooks/UpdateTabTitle.hook.ts"],
    cwd: repoRoot,
    env: withEnv({
      OPENCODE_ROOT: args.runtimeRoot,
      PAI_DISABLE_UPDATE_TAB_TITLE_INFERENCE: "1",
      CMUX_SOCKET_PATH: args.socketPath,
      CMUX_SURFACE_ID: "surface-phase-mirror",
      CMUX_WORKSPACE_ID: "workspace-phase-mirror",
    }),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(JSON.stringify(args.payload));
  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

describe("UpdateTabTitle attention phase mirror", () => {
  test("normal prompt keeps title updates and emits oc_phase mirror with matching progress labels", async () => {
    const runtimeRoot = await makeRuntimeRoot("pai-update-title-phase-");
    const socketDir = await fs.mkdtemp(path.join(os.tmpdir(), "pai-update-title-cmux-"));
    const socketPath = path.join(socketDir, "cmux.sock");

    const capturedV2: V2Request[] = [];
    const capturedLegacy: string[] = [];

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
            capturedV2.push(request);
            connection.write(JSON.stringify({ id: request.id, ok: true, result: {} }) + "\n");
            continue;
          }

          capturedLegacy.push(line);
          connection.write("OK\n");
        }
      });
    });

    await listenServer(server, socketPath);

    try {
      const result = await runUpdateTabTitleHook({
        runtimeRoot,
        socketPath,
        payload: {
          session_id: "S-phase",
          prompt: "fix auth refresh token rotation",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");

      const snapshotRaw = await fs.readFile(tabStatePath(runtimeRoot, "S-phase"), "utf8");
      const snapshot = JSON.parse(snapshotRaw) as { title?: string; state?: string };
      expect(snapshot.state).toBe("working");
      expect(snapshot.title?.startsWith("⚙️")).toBe(true);

      const renameRequests = capturedV2.filter((request) => request.method === "surface.action");
      expect(renameRequests).toHaveLength(2);
      expect((renameRequests[0]?.params.title as string | undefined) ?? "").toContain("🧠");
      expect((renameRequests[1]?.params.title as string | undefined) ?? "").toContain("⚙️");

      const phaseCommands = capturedLegacy.filter((line) => line.startsWith("set_status oc_phase "));
      expect(phaseCommands).toContain("set_status oc_phase THINK --tab=workspace-phase-mirror");
      expect(phaseCommands).toContain("set_status oc_phase WORK --tab=workspace-phase-mirror");

      const progressCommands = capturedLegacy.filter((line) => line.startsWith("set_progress "));
      expect(progressCommands.some((line) => line.includes("\"THINK\""))).toBe(true);
      expect(progressCommands.some((line) => line.includes("\"WORK\""))).toBe(true);
    } finally {
      await closeServer(server);
      await fs.rm(runtimeRoot, { recursive: true, force: true });
      await fs.rm(socketDir, { recursive: true, force: true });
    }
  });
});
