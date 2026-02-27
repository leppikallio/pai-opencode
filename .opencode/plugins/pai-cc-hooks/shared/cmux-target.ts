import { lookupSessionMapping } from "./cmux-session-map";

type TargetSource = "explicit" | "map" | "env";

export type CmuxTarget =
  | {
      kind: "workspace_surface";
      workspaceId: string;
      surfaceId: string;
      source: TargetSource;
    }
  | {
      kind: "surface";
      surfaceId: string;
      source: TargetSource;
    }
  | {
      kind: "none";
      reason:
        | "no_target"
        | "explicit_incomplete_target"
        | "workspace_without_surface"
        | "surface_without_workspace";
      source?: TargetSource;
    };

function trimValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveFromSource(args: {
  source: TargetSource;
  workspaceId: string | null;
  surfaceId: string | null;
}): CmuxTarget {
  if (args.workspaceId && args.surfaceId) {
    return {
      kind: "workspace_surface",
      workspaceId: args.workspaceId,
      surfaceId: args.surfaceId,
      source: args.source,
    };
  }

  if (args.surfaceId) {
    return {
      kind: "surface",
      surfaceId: args.surfaceId,
      source: args.source,
    };
  }

  if (args.workspaceId) {
    return {
      kind: "none",
      reason: "workspace_without_surface",
      source: args.source,
    };
  }

  return {
    kind: "none",
    reason: "no_target",
  };
}

export async function resolveCmuxTarget(args: {
  sessionId: string;
  explicitWorkspaceId?: string | null;
  explicitSurfaceId?: string | null;
}): Promise<CmuxTarget> {
  const explicitWorkspaceId = trimValue(args.explicitWorkspaceId);
  const explicitSurfaceId = trimValue(args.explicitSurfaceId);

  if (explicitWorkspaceId && explicitSurfaceId) {
    return {
      kind: "workspace_surface",
      workspaceId: explicitWorkspaceId,
      surfaceId: explicitSurfaceId,
      source: "explicit",
    };
  }

  if (explicitWorkspaceId || explicitSurfaceId) {
    return {
      kind: "none",
      reason: "explicit_incomplete_target",
      source: "explicit",
    };
  }

  const mapping = await lookupSessionMapping({ sessionId: args.sessionId });
  const mapWorkspaceId = trimValue(mapping?.workspaceId);
  const mapSurfaceId = trimValue(mapping?.surfaceId);

  if (mapWorkspaceId || mapSurfaceId) {
    return resolveFromSource({
      source: "map",
      workspaceId: mapWorkspaceId,
      surfaceId: mapSurfaceId,
    });
  }

  const envWorkspaceId = trimValue(process.env.CMUX_WORKSPACE_ID);
  const envSurfaceId = trimValue(process.env.CMUX_SURFACE_ID);

  if (envWorkspaceId || envSurfaceId) {
    return resolveFromSource({
      source: "env",
      workspaceId: envWorkspaceId,
      surfaceId: envSurfaceId,
    });
  }

  return {
    kind: "none",
    reason: "no_target",
  };
}
