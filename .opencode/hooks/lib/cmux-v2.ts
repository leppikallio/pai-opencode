import net from "node:net";

import { CmuxV2Client } from "../../plugins/pai-cc-hooks/shared/cmux-v2-client";

const LEGACY_STATUS_KEY = "opencode_tab_title";
const PHASE_STATUS_KEY = "oc_phase";

type LegacyStatusTheme = {
  emoji: string;
  label: string;
  icon: string;
  color: string;
  progress: number;
};

const LEGACY_STATUS_THEMES: LegacyStatusTheme[] = [
  { emoji: "👁️", label: "OBSERVE", icon: "eye.fill", color: "#06B6D4", progress: 0.10 },
  { emoji: "🧠", label: "THINK", icon: "brain.head.profile", color: "#4C8DFF", progress: 0.20 },
  { emoji: "📋", label: "PLAN", icon: "list.bullet.clipboard", color: "#0EA5E9", progress: 0.35 },
  { emoji: "🔨", label: "BUILD", icon: "hammer.fill", color: "#EA580C", progress: 0.55 },
  { emoji: "⚙️", label: "WORK", icon: "gearshape.fill", color: "#3B82F6", progress: 0.60 },
  { emoji: "⚙", label: "WORK", icon: "gearshape.fill", color: "#3B82F6", progress: 0.60 },
  { emoji: "⚡", label: "EXECUTE", icon: "bolt.fill", color: "#EAB308", progress: 0.75 },
  { emoji: "❓", label: "QUESTION", icon: "questionmark.circle.fill", color: "#F59E0B", progress: 0.85 },
  { emoji: "📚", label: "LEARN", icon: "book.fill", color: "#14B8A6", progress: 0.90 },
  { emoji: "✅", label: "DONE", icon: "checkmark.circle.fill", color: "#10B981", progress: 1.00 },
];

const PROGRESS_BY_PHASE_TOKEN: Record<string, number> = {
  OBSERVE: 0.10,
  THINK: 0.20,
  PLAN: 0.35,
  BUILD: 0.55,
  WORK: 0.60,
  EXECUTE: 0.75,
  QUESTION: 0.85,
  LEARN: 0.90,
  DONE: 1.00,
};

function readEnv(name: "CMUX_SOCKET_PATH" | "CMUX_SURFACE_ID" | "CMUX_WORKSPACE_ID"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function isMethodNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const withCode = error as { code?: string };
  return withCode.code === "method_not_found";
}

function toQuotedV1Arg(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return `"${escaped}"`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePhaseToken(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "_");
}

function normalizeProgressValue(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  const rounded = Math.round(clamped * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }

  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

function buildLegacyStatus(title: string): {
  value: string;
  icon: string;
  color: string;
  label: string;
  progress: number;
} {
  const normalized = collapseWhitespace(title);
  const matchedTheme = LEGACY_STATUS_THEMES.find((theme) => normalized.startsWith(theme.emoji));

  if (!matchedTheme) {
    return {
      value: normalized,
      icon: "bolt.fill",
      color: "#4C8DFF",
      label: "WORK",
      progress: 0.60,
    };
  }

  const withoutEmoji = collapseWhitespace(normalized.slice(matchedTheme.emoji.length));
  const value = withoutEmoji ? `${matchedTheme.label}: ${withoutEmoji}` : matchedTheme.label;

  return {
    value,
    icon: matchedTheme.icon,
    color: matchedTheme.color,
    label: matchedTheme.label,
    progress: matchedTheme.progress,
  };
}

async function sendV1Command(args: {
  socketPath: string;
  command: string;
  timeoutMs: number;
}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ path: args.socketPath });
    socket.setEncoding("utf8");

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let responseLine = "";
    let responseBuffer = "";

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      socket.off("error", onError);
      socket.off("connect", onConnect);
      socket.off("data", onData);
      socket.off("end", onEnd);
    };

    const settle = (error: Error | null) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      socket.destroy();

      if (error) {
        reject(error);
        return;
      }

      resolve(responseLine.trim());
    };

    const onError = (error: Error) => {
      settle(error);
    };

    const onConnect = () => {
      socket.write(`${args.command}\n`);
    };

    const onData = (data: string) => {
      responseBuffer += data;
      const newlineIndex = responseBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      responseLine = responseBuffer.slice(0, newlineIndex).trim();
      settle(null);
    };

    const onEnd = () => {
      if (responseLine) {
        settle(null);
        return;
      }

      const partialLine = responseBuffer.trim();
      if (partialLine) {
        responseLine = partialLine;
        settle(null);
        return;
      }

      settle(new Error("cmux v1 command ended without response"));
    };

    socket.on("error", onError);
    socket.on("connect", onConnect);
    socket.on("data", onData);
    socket.on("end", onEnd);

    timer = setTimeout(() => {
      settle(new Error(`cmux v1 command timed out after ${args.timeoutMs}ms`));
    }, args.timeoutMs);
  });
}

function isErrorResponseLine(line: string): boolean {
  return line.trim().toUpperCase().startsWith("ERROR:");
}

async function sendLegacyCommandWithWorkspaceFallback(args: {
  socketPath: string;
  commandWithoutTab: string;
  workspaceId: string | null;
}): Promise<void> {
  const withTab = args.workspaceId
    ? `${args.commandWithoutTab} --tab=${args.workspaceId}`
    : args.commandWithoutTab;

  const first = await sendV1Command({
    socketPath: args.socketPath,
    command: withTab,
    timeoutMs: 1200,
  });

  if (!isErrorResponseLine(first)) {
    return;
  }

  if (!args.workspaceId) {
    throw new Error(first || "cmux v1 command failed");
  }

  const retry = await sendV1Command({
    socketPath: args.socketPath,
    command: args.commandWithoutTab,
    timeoutMs: 1200,
  });

  if (isErrorResponseLine(retry)) {
    throw new Error(retry || first || "cmux v1 command failed");
  }
}

async function resolveWorkspaceId(client: CmuxV2Client): Promise<string | null> {
  const envWorkspaceId = readEnv("CMUX_WORKSPACE_ID");
  if (envWorkspaceId) {
    return envWorkspaceId;
  }

  try {
    const identify = await client.call("system.identify", {});
    const identifyRecord = asRecord(identify);
    const focused = identifyRecord ? asRecord(identifyRecord.focused) : null;

    if (!focused) {
      return null;
    }

    return asString(focused.workspace_id) ?? asString(focused.workspace_ref);
  } catch {
    return null;
  }
}

async function setLegacyStatusTitle(args: {
  socketPath: string;
  title: string;
  workspaceId: string | null;
}): Promise<void> {
  const normalized = args.title.trim();
  if (!normalized) {
    return;
  }

  const status = buildLegacyStatus(normalized);
  await sendLegacyCommandWithWorkspaceFallback({
    socketPath: args.socketPath,
    commandWithoutTab: `set_status ${LEGACY_STATUS_KEY} ${toQuotedV1Arg(status.value)} --icon=${status.icon} --color=${status.color}`,
    workspaceId: args.workspaceId,
  });

  await sendLegacyCommandWithWorkspaceFallback({
    socketPath: args.socketPath,
    commandWithoutTab: `set_progress ${normalizeProgressValue(status.progress)} --label=${toQuotedV1Arg(status.label)}`,
    workspaceId: args.workspaceId,
  });
}

export async function mirrorCurrentCmuxPhase(args: { phaseToken: string }): Promise<void> {
  const phaseToken = normalizePhaseToken(args.phaseToken);
  if (!phaseToken) {
    return;
  }

  const socketPath = readEnv("CMUX_SOCKET_PATH");
  if (!socketPath) {
    return;
  }

  const workspaceId = readEnv("CMUX_WORKSPACE_ID");
  const progress = normalizeProgressValue(PROGRESS_BY_PHASE_TOKEN[phaseToken] ?? 0.60);

  try {
    await sendLegacyCommandWithWorkspaceFallback({
      socketPath,
      commandWithoutTab: `set_status ${PHASE_STATUS_KEY} ${phaseToken}`,
      workspaceId,
    });

    await sendLegacyCommandWithWorkspaceFallback({
      socketPath,
      commandWithoutTab: `set_progress ${progress} --label=${toQuotedV1Arg(phaseToken)}`,
      workspaceId,
    });
  } catch {
    // Best-effort by contract.
  }
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

  const client = new CmuxV2Client({ socketPath, timeoutMs: 1500 });

  try {
    await client.call("surface.action", {
      surface_id: surfaceId,
      action: "rename",
      title: normalizedTitle,
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
      title: normalizedTitle,
    });
    return;
  } catch (error) {
    if (!isMethodNotFoundError(error)) {
      return;
    }
  }

  try {
    const workspaceId = await resolveWorkspaceId(client);
    await setLegacyStatusTitle({ socketPath, title: normalizedTitle, workspaceId });
  } catch {
    // Best-effort by contract.
  }
}
