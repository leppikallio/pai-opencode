import { CmuxV2Client } from "../../plugins/pai-cc-hooks/shared/cmux-v2-client";

function readEnv(name: "CMUX_SOCKET_PATH" | "CMUX_SURFACE_ID"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export async function renameCurrentCmuxSurfaceTitle(title: string): Promise<void> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return;
  }

  const socketPath = readEnv("CMUX_SOCKET_PATH");
  if (!socketPath) {
    return;
  }

  const surfaceId = readEnv("CMUX_SURFACE_ID");
  if (!surfaceId) {
    return;
  }

  try {
    const client = new CmuxV2Client({ socketPath, timeoutMs: 1500 });
    await client.call("surface.action", {
      surface_id: surfaceId,
      action: "rename",
      title: normalizedTitle,
    });
  } catch {
    // Best-effort by contract.
  }
}
