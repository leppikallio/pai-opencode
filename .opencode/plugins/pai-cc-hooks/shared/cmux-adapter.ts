import net from "node:net";

import { lookupSessionMapping, syncSessionMappingFromEnv } from "./cmux-session-map";
import { CmuxV2Client } from "./cmux-v2-client";

export type NotifyRoute =
  | "notification.create_for_target"
  | "notification.create_for_surface"
  | "notification.create"
  | "none";

type CmuxClientError = Error & { code?: string };

function trimEnv(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isMethodNotFoundError(error: unknown): boolean {
  return Boolean((error as CmuxClientError | undefined)?.code === "method_not_found");
}

export function resolveSocketPath(): string | null {
  return trimEnv(process.env.CMUX_SOCKET_PATH);
}

async function refreshSessionMapping(sessionId: string): Promise<void> {
  try {
    await syncSessionMappingFromEnv(sessionId);
  } catch {
    // Best effort only.
  }
}

export async function resolveSurfaceId(args: { sessionId: string }): Promise<string | null> {
  const envSurfaceId = trimEnv(process.env.CMUX_SURFACE_ID);
  if (envSurfaceId) {
    return envSurfaceId;
  }

  const mapping = await lookupSessionMapping({ sessionId: args.sessionId });
  return trimEnv(mapping?.surfaceId);
}

async function resolveTarget(args: {
  sessionId: string;
  workspaceId?: string | null;
  surfaceId?: string | null;
}): Promise<{ workspaceId: string | null; surfaceId: string | null }> {
  const workspaceFromArgs = trimEnv(args.workspaceId);
  const surfaceFromArgs = trimEnv(args.surfaceId);

  if (workspaceFromArgs && surfaceFromArgs) {
    return { workspaceId: workspaceFromArgs, surfaceId: surfaceFromArgs };
  }

  const workspaceFromEnv = trimEnv(process.env.CMUX_WORKSPACE_ID);
  const surfaceFromEnv = trimEnv(process.env.CMUX_SURFACE_ID);

  if ((workspaceFromArgs ?? workspaceFromEnv) && (surfaceFromArgs ?? surfaceFromEnv)) {
    return {
      workspaceId: workspaceFromArgs ?? workspaceFromEnv,
      surfaceId: surfaceFromArgs ?? surfaceFromEnv,
    };
  }

  const mapping = await lookupSessionMapping({ sessionId: args.sessionId });

  return {
    workspaceId: workspaceFromArgs ?? workspaceFromEnv ?? trimEnv(mapping?.workspaceId),
    surfaceId: surfaceFromArgs ?? surfaceFromEnv ?? trimEnv(mapping?.surfaceId),
  };
}

async function writeSocketLine(args: {
  socketPath: string;
  line: string;
  timeoutMs?: number;
}): Promise<void> {
  await new Promise<void>((resolve) => {
    const socket = net.createConnection({ path: args.socketPath });
    const timeoutMs = args.timeoutMs ?? 500;
    let settled = false;

    const timer = setTimeout(() => {
      finish();
    }, timeoutMs);

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve();
    };

    socket.on("connect", () => {
      socket.end(`${args.line}\n`);
    });

    socket.on("error", () => {
      finish();
    });

    socket.on("close", () => {
      finish();
    });
  });
}

function normalizeLegacyToken(value: string): string {
  return value.trim().replace(/\s+/g, "_");
}

function normalizeProgressValue(value: number | undefined): string {
  const parsed = Number.isFinite(value) ? Number(value) : 1;
  const clamped = Math.min(1, Math.max(0, parsed));
  const rounded = Math.round(clamped * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }

  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

async function sendLegacyCommand(line: string): Promise<void> {
  const socketPath = resolveSocketPath();
  if (!socketPath) {
    return;
  }

  try {
    await writeSocketLine({ socketPath, line });
  } catch {
    // No-op by design.
  }
}

export async function setStatus(args: { key: string; value: string }): Promise<void> {
  const key = normalizeLegacyToken(args.key);
  const value = normalizeLegacyToken(args.value);
  if (!key || !value) {
    return;
  }

  await sendLegacyCommand(`set_status ${key} ${value}`);
}

export async function clearStatus(args: { key: string }): Promise<void> {
  const key = normalizeLegacyToken(args.key);
  if (!key) {
    return;
  }

  await sendLegacyCommand(`clear_status ${key}`);
}

export async function setProgress(args: { label: string; value?: number }): Promise<void> {
  const label = normalizeLegacyToken(args.label);
  if (!label) {
    return;
  }

  await sendLegacyCommand(`set_progress ${normalizeProgressValue(args.value)} ${label}`);
}

export async function clearProgress(): Promise<void> {
  await sendLegacyCommand("clear_progress");
}

export async function notifyTargeted(args: {
  sessionId: string;
  workspaceId?: string | null;
  surfaceId?: string | null;
  title: string;
  subtitle: string;
  body: string;
}): Promise<NotifyRoute> {
  const socketPath = resolveSocketPath();
  if (!socketPath) {
    return "none";
  }

  await refreshSessionMapping(args.sessionId);

  const client = new CmuxV2Client({ socketPath });
  const target = await resolveTarget({
    sessionId: args.sessionId,
    workspaceId: args.workspaceId,
    surfaceId: args.surfaceId,
  });

  if (target.workspaceId && target.surfaceId) {
    try {
      await client.call("notification.create_for_target", {
        workspace_id: target.workspaceId,
        surface_id: target.surfaceId,
        title: args.title,
        subtitle: args.subtitle,
        body: args.body,
      });
      return "notification.create_for_target";
    } catch {
      // Fall through to next fallback.
    }
  }

  if (target.surfaceId) {
    try {
      await client.call("notification.create_for_surface", {
        surface_id: target.surfaceId,
        title: args.title,
        subtitle: args.subtitle,
        body: args.body,
      });
      return "notification.create_for_surface";
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
    return "notification.create";
  } catch {
    return "none";
  }
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

  await refreshSessionMapping(args.sessionId);

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

export async function triggerFlashForSession(args: { sessionId: string }): Promise<void> {
  const socketPath = resolveSocketPath();
  if (!socketPath) {
    return;
  }

  await refreshSessionMapping(args.sessionId);

  const surfaceId = await resolveSurfaceId({ sessionId: args.sessionId });
  if (!surfaceId) {
    return;
  }

  const client = new CmuxV2Client({ socketPath });

  try {
    await client.call("surface.trigger_flash", {
      surface_id: surfaceId,
    });
  } catch {
    // No-op by design.
  }
}

export async function renameSurface(args: {
  sessionId: string;
  title: string;
}): Promise<void> {
  const socketPath = resolveSocketPath();
  if (!socketPath) {
    return;
  }

  try {
    const surfaceId = await resolveSurfaceId({ sessionId: args.sessionId });
    if (!surfaceId) {
      return;
    }

    const client = new CmuxV2Client({ socketPath });
    try {
      await client.call("surface.action", {
        surface_id: surfaceId,
        action: "rename",
        title: args.title,
      });
      return;
    } catch (error) {
      if (!isMethodNotFoundError(error)) {
        return;
      }
    }

    try {
      await client.call("tab.action", {
        tab_id: surfaceId,
        action: "rename",
        title: args.title,
      });
    } catch {
      // No-op by design.
    }
  } catch {
    // No-op by design.
  }
}

export async function clearSurfaceTitle(args: { sessionId: string }): Promise<void> {
  const socketPath = resolveSocketPath();
  if (!socketPath) {
    return;
  }

  try {
    const surfaceId = await resolveSurfaceId({ sessionId: args.sessionId });
    if (!surfaceId) {
      return;
    }

    const client = new CmuxV2Client({ socketPath });
    try {
      await client.call("surface.action", {
        surface_id: surfaceId,
        action: "clear_name",
      });
      return;
    } catch (error) {
      if (!isMethodNotFoundError(error)) {
        return;
      }
    }

    try {
      await client.call("tab.action", {
        tab_id: surfaceId,
        action: "clear_name",
      });
    } catch {
      // No-op by design.
    }
  } catch {
    // No-op by design.
  }
}
