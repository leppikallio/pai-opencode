import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveCmuxTarget,
  type CmuxTarget,
} from "../../plugins/pai-cc-hooks/shared/cmux-target";

type Case = {
  name: string;
  explicitWorkspaceId?: string | null;
  explicitSurfaceId?: string | null;
  mapWorkspaceId?: string;
  mapSurfaceId?: string;
  envWorkspaceId?: string;
  envSurfaceId?: string;
  expected: CmuxTarget;
};

function restoreEnv(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = previousValue;
}

function writeSessionMap(args: {
  homeDir: string;
  sessionId: string;
  workspaceId?: string;
  surfaceId?: string;
}): void {
  if (!args.workspaceId && !args.surfaceId) {
    return;
  }

  const statePath = path.join(args.homeDir, ".cmuxterm", "opencode-hook-sessions.json");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        version: 1,
        sessions: {
          [args.sessionId]: {
            sessionId: args.sessionId,
            ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
            ...(args.surfaceId ? { surfaceId: args.surfaceId } : {}),
            startedAt: 1,
            updatedAt: 1,
          },
        },
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
}

async function runCase(caseDef: Case): Promise<void> {
  const sessionId = `ses_${Math.random().toString(16).slice(2)}`;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-target-home-"));

  const previousHome = process.env.HOME;
  const previousWorkspace = process.env.CMUX_WORKSPACE_ID;
  const previousSurface = process.env.CMUX_SURFACE_ID;

  process.env.HOME = homeDir;

  if (caseDef.envWorkspaceId === undefined) {
    delete process.env.CMUX_WORKSPACE_ID;
  } else {
    process.env.CMUX_WORKSPACE_ID = caseDef.envWorkspaceId;
  }

  if (caseDef.envSurfaceId === undefined) {
    delete process.env.CMUX_SURFACE_ID;
  } else {
    process.env.CMUX_SURFACE_ID = caseDef.envSurfaceId;
  }

  writeSessionMap({
    homeDir,
    sessionId,
    workspaceId: caseDef.mapWorkspaceId,
    surfaceId: caseDef.mapSurfaceId,
  });

  try {
    const target = await resolveCmuxTarget({
      sessionId,
      explicitWorkspaceId: caseDef.explicitWorkspaceId,
      explicitSurfaceId: caseDef.explicitSurfaceId,
    });

    expect(target).toEqual(caseDef.expected);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
    restoreEnv("HOME", previousHome);
    restoreEnv("CMUX_WORKSPACE_ID", previousWorkspace);
    restoreEnv("CMUX_SURFACE_ID", previousSurface);
  }
}

describe("cmux target resolution", () => {
  test("resolves target source-atomically with explicit, map, and env precedence", async () => {
    const cases: Case[] = [
      {
        name: "explicit workspace+surface wins",
        explicitWorkspaceId: "explicit-workspace",
        explicitSurfaceId: "explicit-surface",
        mapWorkspaceId: "map-workspace",
        mapSurfaceId: "map-surface",
        envWorkspaceId: "env-workspace",
        envSurfaceId: "env-surface",
        expected: {
          kind: "workspace_surface",
          workspaceId: "explicit-workspace",
          surfaceId: "explicit-surface",
          source: "explicit",
        },
      },
      {
        name: "explicit surface does not pull workspace from map or env",
        explicitSurfaceId: "explicit-surface",
        mapWorkspaceId: "map-workspace",
        mapSurfaceId: "map-surface",
        envWorkspaceId: "env-workspace",
        envSurfaceId: "env-surface",
        expected: {
          kind: "none",
          reason: "explicit_incomplete_target",
          source: "explicit",
        },
      },
      {
        name: "explicit workspace does not pull surface from map or env",
        explicitWorkspaceId: "explicit-workspace",
        mapWorkspaceId: "map-workspace",
        mapSurfaceId: "map-surface",
        envWorkspaceId: "env-workspace",
        envSurfaceId: "env-surface",
        expected: {
          kind: "none",
          reason: "explicit_incomplete_target",
          source: "explicit",
        },
      },
      {
        name: "session map wins over env",
        mapWorkspaceId: "map-workspace",
        mapSurfaceId: "map-surface",
        envWorkspaceId: "env-workspace",
        envSurfaceId: "env-surface",
        expected: {
          kind: "workspace_surface",
          workspaceId: "map-workspace",
          surfaceId: "map-surface",
          source: "map",
        },
      },
      {
        name: "env is fallback only when no mapping exists",
        envWorkspaceId: "env-workspace",
        envSurfaceId: "env-surface",
        expected: {
          kind: "workspace_surface",
          workspaceId: "env-workspace",
          surfaceId: "env-surface",
          source: "env",
        },
      },
      {
        name: "non-mixing when map has workspace only and env has both",
        mapWorkspaceId: "map-workspace-only",
        envWorkspaceId: "env-workspace",
        envSurfaceId: "env-surface",
        expected: {
          kind: "none",
          reason: "workspace_without_surface",
          source: "map",
        },
      },
      {
        name: "non-mixing when map has surface only and env has workspace only",
        mapSurfaceId: "map-surface-only",
        envWorkspaceId: "env-workspace-only",
        expected: {
          kind: "surface",
          surfaceId: "map-surface-only",
          source: "map",
        },
      },
      {
        name: "env workspace-only cannot create mixed target",
        envWorkspaceId: "env-workspace-only",
        expected: {
          kind: "none",
          reason: "workspace_without_surface",
          source: "env",
        },
      },
      {
        name: "env surface-only resolves to surface target",
        envSurfaceId: "env-surface-only",
        expected: {
          kind: "surface",
          surfaceId: "env-surface-only",
          source: "env",
        },
      },
      {
        name: "no target data returns none",
        expected: {
          kind: "none",
          reason: "no_target",
        },
      },
    ];

    for (const caseDef of cases) {
      await runCase(caseDef);
    }
  });
});
