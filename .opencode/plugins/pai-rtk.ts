import type { Plugin } from "@opencode-ai/plugin";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function getString(obj: UnknownRecord, key: string): string {
  const value = obj[key];
  return typeof value === "string" ? value : "";
}

async function readProcessStdoutText(proc: Bun.Subprocess): Promise<string> {
  if (!proc.stdout) return "";
  const stream = proc.stdout as ReadableStream<Uint8Array>;
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buf);
}

const PaiRtkPlugin: Plugin = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      const tool = getString(asRecord(input), "tool");
      if (tool !== "bash") return;

      const outputRecord = asRecord(output);
      const args = asRecord(outputRecord.args);
      const command = getString(args, "command");
      if (!command) return;
      if (command.startsWith("rtk ")) return;

      const workdir = getString(args, "workdir");

      let proc: Bun.Subprocess;
      try {
        proc = Bun.spawn(["rtk", "rewrite", command], {
          cwd: workdir || undefined,
          stdout: "pipe",
          stderr: "ignore",
        });
      } catch {
        return;
      }

      const exitCode = await proc.exited;
      if (exitCode !== 0) return;

      const rewritten = (await readProcessStdoutText(proc)).trim();
      if (!rewritten) return;
      if (rewritten === command) return;

      args.command = rewritten;
      outputRecord.args = args;
      (output as UnknownRecord).args = args;
    },
  };
};

export default PaiRtkPlugin;
