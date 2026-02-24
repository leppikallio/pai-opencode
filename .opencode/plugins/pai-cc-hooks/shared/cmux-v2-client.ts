import net from "node:net";

type V2Ok = { id?: string | number; ok: true; result: unknown };
type V2Err = { id?: string | number; ok: false; error: { code?: string; message: string } };

export class CmuxV2Client {
  private socketPath: string;
  private nextId = 1;

  constructor(args: { socketPath: string }) {
    this.socketPath = args.socketPath;
  }

  async call(method: string, params: Record<string, unknown>): Promise<any> {
    const id = String(this.nextId++);
    const req = JSON.stringify({ id, method, params }) + "\n";

    const resLine = await new Promise<string>((resolve, reject) => {
      const s = net.createConnection({ path: this.socketPath });
      s.setEncoding("utf8");
      let buf = "";
      s.on("error", reject);
      s.on("connect", () => s.write(req));
      s.on("data", (d) => {
        buf += d;
        if (!buf.includes("\n")) return;
        const line = buf.split("\n")[0];
        s.end();
        resolve(line);
      });
    });

    const parsed = JSON.parse(resLine) as V2Ok | V2Err;
    if (parsed.ok) return parsed.result;
    throw new Error(parsed.error?.message ?? "cmux v2 error");
  }
}
