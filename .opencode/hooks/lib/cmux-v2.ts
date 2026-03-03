import { runCmuxCli } from "../../plugins/pai-cc-hooks/shared/cmux-cli";
import { writeCmuxRouteDecision } from "../../plugins/pai-cc-hooks/shared/cmux-debug";
import { resolveCmuxTarget, type CmuxTarget } from "../../plugins/pai-cc-hooks/shared/cmux-target";

const PHASE_STATUS_KEY = "oc_phase";
const CMUX_TIMEOUT_MS = 1_000;

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

async function runCmuxCliBestEffort(args: string[]): Promise<void> {
  // runCmuxCli() returns structured failure kinds and persists best-effort
  // breadcrumbs for diagnosability.
  await runCmuxCli({
    args,
    timeoutMs: CMUX_TIMEOUT_MS,
  });
}

async function resolveTabTarget(sessionId?: string): Promise<CmuxTarget> {
  const normalizedSessionId = sessionId?.trim();
  if (normalizedSessionId) {
    return await resolveCmuxTarget({ sessionId: normalizedSessionId });
  }

  return await resolveCmuxTarget({ sessionId: "unknown-session" });
}

function appendRenameTargetArgs(cliArgs: string[], target: CmuxTarget): boolean {
  if (target.kind === "workspace_surface") {
    cliArgs.push("--workspace", target.workspaceId, "--surface", target.surfaceId);
    return true;
  }

  if (target.kind === "surface") {
    cliArgs.push("--surface", target.surfaceId);
    return true;
  }

  return false;
}

export async function mirrorCurrentCmuxPhase(args: {
  phaseToken: string;
  sessionId?: string;
}): Promise<void> {
  const phaseToken = normalizePhaseToken(args.phaseToken);
  if (!phaseToken) {
    return;
  }

  try {
    const target = await resolveTabTarget(args.sessionId);
    // set-status/set-progress are currently workspace-scoped, so surface-only targets intentionally no-op.
    if (target.kind !== "workspace_surface") {
      await writeCmuxRouteDecision({
        route: "none",
        sessionId: args.sessionId,
        reason:
          target.kind === "none"
            ? `mirrorCurrentCmuxPhase skipped (no target): ${target.reason}`
            : "mirrorCurrentCmuxPhase skipped (surface-only target)",
        argv: ["set-status", PHASE_STATUS_KEY, phaseToken],
      });
      return;
    }

    const progress = normalizeProgressValue(PROGRESS_BY_PHASE_TOKEN[phaseToken] ?? 0.60);

    await runCmuxCliBestEffort(["set-status", PHASE_STATUS_KEY, phaseToken, "--workspace", target.workspaceId]);
    await runCmuxCliBestEffort([
      "set-progress",
      progress,
      "--label",
      phaseToken,
      "--workspace",
      target.workspaceId,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeCmuxRouteDecision({
      route: "none",
      sessionId: args.sessionId,
      reason: `mirrorCurrentCmuxPhase threw: ${message}`,
      argv: ["set-status", PHASE_STATUS_KEY, phaseToken],
    });
  }
}

export async function renameCurrentCmuxSurfaceTitle(
  title: string,
  args: {
    sessionId?: string;
  } = {},
): Promise<void> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return;
  }

  try {
    const target = await resolveTabTarget(args.sessionId);
    const cliArgs = ["rename-tab"];

    if (!appendRenameTargetArgs(cliArgs, target)) {
      await writeCmuxRouteDecision({
        route: "none",
        sessionId: args.sessionId,
        reason:
          target.kind === "none"
            ? `renameCurrentCmuxSurfaceTitle skipped (no target): ${target.reason}`
            : "renameCurrentCmuxSurfaceTitle skipped (workspace without surface)",
        argv: ["rename-tab"],
      });
      return;
    }

    cliArgs.push("--", normalizedTitle);
    await runCmuxCliBestEffort(cliArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeCmuxRouteDecision({
      route: "none",
      sessionId: args.sessionId,
      reason: `renameCurrentCmuxSurfaceTitle threw: ${message}`,
      argv: ["rename-tab"],
    });
  }
}
