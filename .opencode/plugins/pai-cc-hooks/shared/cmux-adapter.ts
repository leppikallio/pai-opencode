import { runCmuxCli } from "./cmux-cli";
import { writeCmuxRouteDecision } from "./cmux-debug";
import { lookupSessionMapping } from "./cmux-session-map";
import { resolveCmuxTarget, type CmuxTarget } from "./cmux-target";
import { CmuxV2Client } from "./cmux-v2-client";

export type NotifyRoute =
  | "notification.create_for_target"
  | "notification.create_for_surface"
  | "notification.create"
  | "none";

type CmuxClientError = Error & { code?: string };
const CMUX_NOTIFY_TIMEOUT_MS = 1_000;

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

export async function resolveSurfaceId(args: { sessionId: string }): Promise<string | null> {
  const envSurfaceId = trimEnv(process.env.CMUX_SURFACE_ID);
  if (envSurfaceId) {
    return envSurfaceId;
  }

  const mapping = await lookupSessionMapping({ sessionId: args.sessionId });
  return trimEnv(mapping?.surfaceId);
}

type CmuxCommandTarget = {
  workspaceId: string | null;
  surfaceId: string | null;
};

async function resolveCommandTarget(args: { sessionId?: string }): Promise<CmuxCommandTarget> {
  const envWorkspaceId = trimEnv(process.env.CMUX_WORKSPACE_ID);
  const envSurfaceId = trimEnv(process.env.CMUX_SURFACE_ID);
  if (envWorkspaceId || envSurfaceId) {
    return {
      workspaceId: envWorkspaceId,
      surfaceId: envSurfaceId,
    };
  }

  const sessionId = trimEnv(args.sessionId);
  if (!sessionId) {
    return {
      workspaceId: null,
      surfaceId: null,
    };
  }

  const mapping = await lookupSessionMapping({ sessionId });
  return {
    workspaceId: trimEnv(mapping?.workspaceId),
    surfaceId: trimEnv(mapping?.surfaceId),
  };
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

async function runCmuxCommandBestEffort(args: string[]): Promise<void> {
  try {
    await runCmuxCli({
      args,
      timeoutMs: CMUX_NOTIFY_TIMEOUT_MS,
    });
  } catch {
    // No-op by design.
  }
}

async function writeNotifyRouteNoneBreadcrumb(args: {
  sessionId: string;
  title: string;
  subtitle: string;
  body: string;
  reason: string;
}): Promise<void> {
  await writeCmuxRouteDecision({
    route: "none",
    sessionId: args.sessionId,
    reason: args.reason,
    argv: ["notify", "--title", args.title, "--subtitle", args.subtitle, "--body", args.body],
  });
}

type NotifyDeliveryRoute = Exclude<NotifyRoute, "none">;

function buildNotifyArgs(args: {
  title: string;
  subtitle: string;
  body: string;
  workspaceId?: string;
  surfaceId?: string;
}): string[] {
  const cliArgs = ["notify", "--title", args.title, "--subtitle", args.subtitle, "--body", args.body];

  if (args.workspaceId && args.surfaceId) {
    cliArgs.push("--workspace", args.workspaceId, "--surface", args.surfaceId);
    return cliArgs;
  }

  if (args.surfaceId) {
    cliArgs.push("--surface", args.surfaceId);
  }

  return cliArgs;
}

async function attemptNotifyRoute(args: {
  route: NotifyDeliveryRoute;
  cliArgs: string[];
  failures: string[];
}): Promise<boolean> {
  const result = await runCmuxCli({
    args: args.cliArgs,
    timeoutMs: CMUX_NOTIFY_TIMEOUT_MS,
  });

  if (result.kind === "ok") {
    return true;
  }

  args.failures.push(`${args.route}:${result.kind}`);
  return false;
}

async function notifyViaCli(args: {
  sessionId: string;
  title: string;
  subtitle: string;
  body: string;
  target: CmuxTarget;
}): Promise<NotifyRoute> {
  const failures: string[] = [];

  if (args.target.kind === "workspace_surface") {
    if (
      await attemptNotifyRoute({
        route: "notification.create_for_target",
        cliArgs: buildNotifyArgs({
          title: args.title,
          subtitle: args.subtitle,
          body: args.body,
          workspaceId: args.target.workspaceId,
          surfaceId: args.target.surfaceId,
        }),
        failures,
      })
    ) {
      return "notification.create_for_target";
    }

    if (
      await attemptNotifyRoute({
        route: "notification.create_for_surface",
        cliArgs: buildNotifyArgs({
          title: args.title,
          subtitle: args.subtitle,
          body: args.body,
          surfaceId: args.target.surfaceId,
        }),
        failures,
      })
    ) {
      return "notification.create_for_surface";
    }
  } else if (args.target.kind === "surface") {
    if (
      await attemptNotifyRoute({
        route: "notification.create_for_surface",
        cliArgs: buildNotifyArgs({
          title: args.title,
          subtitle: args.subtitle,
          body: args.body,
          surfaceId: args.target.surfaceId,
        }),
        failures,
      })
    ) {
      return "notification.create_for_surface";
    }
  } else {
    failures.push(`target:none:${args.target.reason}`);
  }

  if (
    await attemptNotifyRoute({
      route: "notification.create",
      cliArgs: buildNotifyArgs({
        title: args.title,
        subtitle: args.subtitle,
        body: args.body,
      }),
      failures,
    })
  ) {
    return "notification.create";
  }

  await writeNotifyRouteNoneBreadcrumb({
    sessionId: args.sessionId,
    title: args.title,
    subtitle: args.subtitle,
    body: args.body,
    reason: `notification routing exhausted (${failures.join(", ")})`,
  });
  return "none";
}

export async function setStatus(args: { key: string; value: string; sessionId?: string }): Promise<void> {
  const key = normalizeLegacyToken(args.key);
  const value = normalizeLegacyToken(args.value);
  if (!key || !value) {
    return;
  }

  const target = await resolveCommandTarget({ sessionId: args.sessionId });
  if (!target.workspaceId) {
    return;
  }

  await runCmuxCommandBestEffort(["set-status", key, value, "--workspace", target.workspaceId]);
}

export async function clearStatus(args: { key: string; sessionId?: string }): Promise<void> {
  const key = normalizeLegacyToken(args.key);
  if (!key) {
    return;
  }

  const target = await resolveCommandTarget({ sessionId: args.sessionId });
  if (!target.workspaceId) {
    return;
  }

  await runCmuxCommandBestEffort(["clear-status", key, "--workspace", target.workspaceId]);
}

export async function setProgress(args: { label: string; value?: number; sessionId?: string }): Promise<void> {
  const label = normalizeLegacyToken(args.label);
  if (!label) {
    return;
  }

  const target = await resolveCommandTarget({ sessionId: args.sessionId });
  if (!target.workspaceId) {
    return;
  }

  await runCmuxCommandBestEffort([
    "set-progress",
    normalizeProgressValue(args.value),
    "--label",
    label,
    "--workspace",
    target.workspaceId,
  ]);
}

export async function clearProgress(args: { sessionId?: string } = {}): Promise<void> {
  const target = await resolveCommandTarget({ sessionId: args.sessionId });
  if (!target.workspaceId) {
    return;
  }

  await runCmuxCommandBestEffort(["clear-progress", "--workspace", target.workspaceId]);
}

export async function notifyTargeted(args: {
  sessionId: string;
  workspaceId?: string | null;
  surfaceId?: string | null;
  title: string;
  subtitle: string;
  body: string;
}): Promise<NotifyRoute> {
  const target = await resolveCmuxTarget({
    sessionId: args.sessionId,
    explicitWorkspaceId: args.workspaceId,
    explicitSurfaceId: args.surfaceId,
  });

  return await notifyViaCli({
    sessionId: args.sessionId,
    title: args.title,
    subtitle: args.subtitle,
    body: args.body,
    target,
  });
}

export async function notify(args: {
  sessionId: string;
  title: string;
  subtitle: string;
  body: string;
}): Promise<void> {
  const target = await resolveCmuxTarget({ sessionId: args.sessionId });
  await notifyViaCli({
    sessionId: args.sessionId,
    title: args.title,
    subtitle: args.subtitle,
    body: args.body,
    target,
  });
}

export async function triggerFlashForSession(args: { sessionId: string }): Promise<void> {
  const target = await resolveCommandTarget({ sessionId: args.sessionId });
  if (!target.surfaceId) {
    return;
  }

  const cliArgs = ["trigger-flash", "--surface", target.surfaceId];
  if (target.workspaceId) {
    cliArgs.push("--workspace", target.workspaceId);
  }

  await runCmuxCommandBestEffort(cliArgs);
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
