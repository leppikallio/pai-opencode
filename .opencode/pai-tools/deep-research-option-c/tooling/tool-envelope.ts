import { makeToolContext } from "./tool-context";

export type ToolEnvelope = Record<string, unknown> & { ok: boolean };

export type ToolWithExecute = {
  execute: (args: Record<string, unknown>, context?: unknown) => Promise<unknown>;
};

export function parseToolEnvelope(name: string, raw: unknown): ToolEnvelope {
  if (typeof raw !== "string") {
    throw new Error(`${name} returned non-string response`);
  }
  const parsed = JSON.parse(raw) as ToolEnvelope;
  if (!parsed || typeof parsed !== "object" || typeof parsed.ok !== "boolean") {
    throw new Error(`${name} returned invalid JSON envelope`);
  }
  return parsed;
}

export function toolErrorMessage(name: string, envelope: ToolEnvelope): string {
  const errorRaw = envelope.error;
  if (!errorRaw || typeof errorRaw !== "object") {
    return `${name} failed`;
  }
  const error = errorRaw as Record<string, unknown>;
  const code = String(error.code ?? "UNKNOWN");
  const message = String(error.message ?? "Unknown failure");
  const details = JSON.stringify(error.details ?? {});
  return `${name} failed: ${code} ${message} ${details}`;
}

export async function callTool(name: string, tool: ToolWithExecute, args: Record<string, unknown>): Promise<ToolEnvelope> {
  const raw = await tool.execute(args, makeToolContext());
  const envelope = parseToolEnvelope(name, raw);
  if (!envelope.ok) {
    throw new Error(toolErrorMessage(name, envelope));
  }
  return envelope;
}
