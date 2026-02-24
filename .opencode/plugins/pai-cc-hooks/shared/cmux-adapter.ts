import { lookupSessionMapping } from "./cmux-session-map";
import { CmuxV2Client } from "./cmux-v2-client";

export function resolveSocketPath(): string | null {
  const socketPath = process.env.CMUX_SOCKET_PATH?.trim();
  return socketPath ? socketPath : null;
}

export async function resolveSurfaceId(args: { sessionId: string }): Promise<string | null> {
  const envSurfaceId = process.env.CMUX_SURFACE_ID?.trim();
  if (envSurfaceId) {
    return envSurfaceId;
  }

  const mapping = await lookupSessionMapping({ sessionId: args.sessionId });
  return mapping?.surfaceId ?? null;
}

export async function notify(args: {
  sessionId: string;
  title: string;
  subtitle: string;
  body: string;
}): Promise<void> {
  const socketPath = resolveSocketPath();
  if (!socketPath) {
    return;
  }

  const client = new CmuxV2Client({ socketPath });
  const surfaceId = await resolveSurfaceId({ sessionId: args.sessionId });

  if (surfaceId) {
    try {
      await client.call("notification.create_for_surface", {
        surface_id: surfaceId,
        title: args.title,
        subtitle: args.subtitle,
        body: args.body,
      });
      return;
    } catch {
      // Fall through to untargeted notify.
    }
  }

  try {
    await client.call("notification.create", {
      title: args.title,
      subtitle: args.subtitle,
      body: args.body,
    });
  } catch {
    // No-op by design.
  }
}
