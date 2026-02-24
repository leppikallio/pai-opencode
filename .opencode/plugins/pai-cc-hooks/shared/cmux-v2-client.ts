import net from "node:net";

type V2Ok = { id?: string | number; ok: true; result: unknown };
type V2Err = { id?: string | number; ok: false; error: { code?: string; message: string } };
type CmuxClientError = Error & { code?: string };

function createClientError(args: {
  message: string;
  method: string;
  socketPath: string;
  code?: string;
}): CmuxClientError {
  const err = new Error(
    `cmux v2 call failed (${args.method} via ${args.socketPath}): ${args.message}`,
  ) as CmuxClientError;
  if (args.code) err.code = args.code;
  return err;
}

export class CmuxV2Client {
  private socketPath: string;
  private timeoutMs: number;
  private nextId = 1;

  constructor(args: { socketPath: string; timeoutMs?: number }) {
    this.socketPath = args.socketPath;
    this.timeoutMs = args.timeoutMs ?? 5000;
  }

  async call(method: string, params: Record<string, unknown>): Promise<any> {
    const id = String(this.nextId++);
    const req = JSON.stringify({ id, method, params }) + "\n";

    const resLine = await new Promise<string>((resolve, reject) => {
      const s = net.createConnection({ path: this.socketPath });
      s.setEncoding("utf8");
      let buf = "";
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        s.off("error", onError);
        s.off("connect", onConnect);
        s.off("data", onData);
      };

      const settle = (line: string | null, err: CmuxClientError | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        s.destroy();
        if (err) {
          reject(err);
          return;
        }
        resolve(line ?? "");
      };

      const onError = (error: Error & { code?: string }) => {
        settle(
          null,
          createClientError({
            message: error.message,
            method,
            socketPath: this.socketPath,
            code: error.code,
          }),
        );
      };

      const onConnect = () => {
        s.write(req);
      };

      const onData = (d: string) => {
        buf += d;
        if (!buf.includes("\n")) return;
        const line = buf.split("\n")[0];
        settle(line, null);
      };

      s.on("error", onError);
      s.on("connect", onConnect);
      s.on("data", onData);

      timer = setTimeout(() => {
        settle(
          null,
          createClientError({
            message: `timed out after ${this.timeoutMs}ms`,
            method,
            socketPath: this.socketPath,
            code: "ETIMEDOUT",
          }),
        );
      }, this.timeoutMs);
    });

    let parsed: V2Ok | V2Err;
    try {
      parsed = JSON.parse(resLine) as V2Ok | V2Err;
    } catch {
      throw createClientError({
        message: "invalid JSON response",
        method,
        socketPath: this.socketPath,
        code: "EBADMSG",
      });
    }

    if (parsed.ok) return parsed.result;
    throw createClientError({
      message: parsed.error?.message ?? "cmux v2 error",
      method,
      socketPath: this.socketPath,
      code: parsed.error?.code,
    });
  }
}
