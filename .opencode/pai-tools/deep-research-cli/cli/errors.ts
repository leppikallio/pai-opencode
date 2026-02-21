type TickResultLike =
  | { ok: true }
  | { ok: false; error: { code?: unknown; message?: unknown } };

export function toolErrorDetails(error: unknown): { code: string; message: string } {
  const text = String(error ?? "unknown error");
  const match = /failed:\s+([^\s]+)\s+([^{]+)(?:\{.*)?$/.exec(text);
  if (!match) {
    return { code: "TOOL_FAILED", message: text };
  }
  return { code: match[1] ?? "TOOL_FAILED", message: (match[2] ?? text).trim() };
}

export function resultErrorDetails(result: TickResultLike): { code: string; message: string } | null {
  if (result.ok) return null;
  return {
    code: String(result.error.code ?? "UNKNOWN"),
    message: String(result.error.message ?? "tick failed"),
  };
}

export function throwWithCode(code: string, message: string): never {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  throw error;
}

export function throwWithCodeAndDetails(code: string, message: string, details: Record<string, unknown>): never {
  const error = new Error(message) as Error & { code?: string; details?: Record<string, unknown> };
  error.code = code;
  error.details = details;
  throw error;
}
