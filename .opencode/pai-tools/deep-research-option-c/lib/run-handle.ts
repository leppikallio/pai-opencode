import * as path from "node:path";

import {
  acquireRunLock,
  releaseRunLock,
} from "../../../tools/deep_research.ts";
import { emitJson } from "../cli/json-mode";
import {
  assertWithinRoot,
  normalizeOptional,
  requireAbsolutePath,
  safeResolveManifestPath,
  validateRunId,
} from "./paths";
import {
  asObject,
  readJsonObject,
} from "./io-json";

export type RunHandleCliArgs = {
  runId?: string;
  runsRoot?: string;
  runRoot?: string;
  manifest?: string;
  gates?: string;
};

export type RunHandleResolution = {
  runRoot: string;
  manifestPath: string;
  gatesPath: string;
  manifest: Record<string, unknown>;
};

export type ManifestSummary = {
  runId: string;
  runRoot: string;
  stageCurrent: string;
  status: string;
  gatesPath: string;
};

export type GateStatusSummary = {
  id: string;
  status: string;
  checked_at: string | null;
};

export type CliContractJson = {
  run_id: string;
  run_root: string;
  manifest_path: string;
  gates_path: string | null;
  stage_current: string;
  status: string;
  gate_statuses_summary: Record<string, { status: string; checked_at: string | null }>;
};

export async function withRunLock<T>(args: { runRoot: string; reason: string; fn: () => Promise<T> }): Promise<T> {
  const lock = await acquireRunLock({ run_root: args.runRoot, lease_seconds: 60, reason: args.reason });
  if (!lock.ok) {
    throw new Error(`run lock failed: ${lock.code} ${lock.message} ${JSON.stringify(lock.details ?? {})}`);
  }

  try {
    return await args.fn();
  } finally {
    await releaseRunLock(lock.handle).catch(() => undefined);
  }
}

export function resolveRunRoot(manifest: Record<string, unknown>): string {
  const artifacts = asObject(manifest.artifacts);
  const root = String(artifacts.root ?? "").trim();
  if (!root || !path.isAbsolute(root)) {
    throw new Error("manifest.artifacts.root is missing or invalid");
  }
  return root;
}

export async function resolveLogsDirFromManifest(manifest: Record<string, unknown>): Promise<string> {
  const runRoot = resolveRunRoot(manifest);
  const artifacts = asObject(manifest.artifacts);
  const pathsObj = asObject(artifacts.paths);
  const logsRel = String(pathsObj.logs_dir ?? "logs").trim() || "logs";
  return await safeResolveManifestPath(runRoot, logsRel, "manifest.artifacts.paths.logs_dir");
}

export async function resolveGatesPathFromManifest(manifest: Record<string, unknown>): Promise<string> {
  const runRoot = resolveRunRoot(manifest);
  const artifacts = asObject(manifest.artifacts);
  const pathsObj = asObject(artifacts.paths);
  const gatesRel = String(pathsObj.gates_file ?? "gates.json").trim() || "gates.json";
  return safeResolveManifestPath(runRoot, gatesRel, "manifest.artifacts.paths.gates_file");
}

export async function resolvePerspectivesPathFromManifest(manifest: Record<string, unknown>): Promise<string> {
  const runRoot = resolveRunRoot(manifest);
  const artifacts = asObject(manifest.artifacts);
  const pathsObj = asObject(artifacts.paths);
  const perspectivesRel = String(pathsObj.perspectives_file ?? "perspectives.json").trim() || "perspectives.json";
  return safeResolveManifestPath(runRoot, perspectivesRel, "manifest.artifacts.paths.perspectives_file");
}

export async function resolveRunHandle(args: RunHandleCliArgs): Promise<RunHandleResolution> {
  const manifestArg = normalizeOptional(args.manifest);
  const runRootArg = normalizeOptional(args.runRoot);
  const runIdArg = normalizeOptional(args.runId);
  const runsRootArg = normalizeOptional(args.runsRoot);

  const selectors = [manifestArg, runRootArg, runIdArg].filter((value) => typeof value === "string").length;
  if (selectors === 0) {
    throw new Error("one of --manifest, --run-root, or --run-id is required");
  }
  if (selectors > 1) {
    throw new Error("provide only one of --manifest, --run-root, or --run-id");
  }

  let manifestPath: string;
  if (manifestArg) {
    manifestPath = requireAbsolutePath(manifestArg, "--manifest");
  } else if (runRootArg) {
    const runRootAbs = requireAbsolutePath(runRootArg, "--run-root");
    manifestPath = path.join(runRootAbs, "manifest.json");
  } else {
    validateRunId(runIdArg as string);
    if (!runsRootArg) {
      throw new Error("--runs-root is required when using --run-id");
    }
    const runsRoot = requireAbsolutePath(runsRootArg, "--runs-root");
    const runRootFromId = path.resolve(runsRoot, runIdArg as string);
    assertWithinRoot(runsRoot, runRootFromId, "--run-id");
    manifestPath = path.join(runRootFromId, "manifest.json");
  }

  const manifest = await readJsonObject(manifestPath);
  const runRoot = resolveRunRoot(manifest);
  const gatesDerived = await resolveGatesPathFromManifest(manifest);
  const gatesArg = normalizeOptional(args.gates);
  const gatesPath = gatesArg ? requireAbsolutePath(gatesArg, "--gates") : gatesDerived;

  if (runRootArg) {
    const expected = path.resolve(requireAbsolutePath(runRootArg, "--run-root"));
    const actual = path.resolve(runRoot);
    if (expected !== actual) {
      throw new Error(`--run-root mismatch: manifest resolves root ${actual}`);
    }
  }

  if (runIdArg) {
    const manifestRunId = String(manifest.run_id ?? "").trim();
    if (manifestRunId && manifestRunId !== runIdArg) {
      throw new Error(`--run-id mismatch: manifest run_id is ${manifestRunId}`);
    }
  }

  return {
    runRoot,
    manifestPath,
    gatesPath,
    manifest,
  };
}

export async function summarizeManifest(manifest: Record<string, unknown>): Promise<ManifestSummary> {
  const stage = asObject(manifest.stage);
  return {
    runId: String(manifest.run_id ?? ""),
    runRoot: resolveRunRoot(manifest),
    stageCurrent: String(stage.current ?? ""),
    status: String(manifest.status ?? ""),
    gatesPath: await resolveGatesPathFromManifest(manifest),
  };
}

export function printContract(args: {
  runId: string;
  runRoot: string;
  manifestPath: string;
  gatesPath: string;
  stageCurrent: string;
  status: string;
}): void {
  console.log(`run_id: ${args.runId}`);
  console.log(`run_root: ${args.runRoot}`);
  console.log(`manifest_path: ${args.manifestPath}`);
  console.log(`gates_path: ${args.gatesPath}`);
  console.log(`stage.current: ${args.stageCurrent}`);
  console.log(`status: ${args.status}`);
}

export function gateStatusesSummaryRecord(gateStatuses: GateStatusSummary[]): Record<string, { status: string; checked_at: string | null }> {
  const out: Record<string, { status: string; checked_at: string | null }> = {};
  for (const gate of gateStatuses) {
    out[gate.id] = {
      status: gate.status,
      checked_at: gate.checked_at,
    };
  }
  return out;
}

export async function readGateStatusesSummary(gatesPath: string): Promise<Record<string, { status: string; checked_at: string | null }>> {
  try {
    const gatesDoc = await readJsonObject(gatesPath);
    return gateStatusesSummaryRecord(parseGateStatuses(gatesDoc));
  } catch {
    return {};
  }
}

export function parseGateStatuses(gatesDoc: Record<string, unknown>): GateStatusSummary[] {
  const gatesObj = asObject(gatesDoc.gates);
  const out: GateStatusSummary[] = [];

  for (const gateId of ["A", "B", "C", "D", "E", "F"]) {
    const gate = asObject(gatesObj[gateId]);
    out.push({
      id: gateId,
      status: String(gate.status ?? "unknown"),
      checked_at: gate.checked_at == null ? null : String(gate.checked_at),
    });
  }

  return out;
}

export function contractJson(args: {
  summary: ManifestSummary;
  manifestPath: string;
  gatesPath?: string;
  gateStatusesSummary: Record<string, { status: string; checked_at: string | null }>;
}): CliContractJson {
  return {
    run_id: args.summary.runId,
    run_root: args.summary.runRoot,
    manifest_path: args.manifestPath,
    gates_path: args.gatesPath ?? args.summary.gatesPath ?? null,
    stage_current: args.summary.stageCurrent,
    status: args.summary.status,
    gate_statuses_summary: args.gateStatusesSummary,
  };
}

export function emitContractCommandJson(args: {
  command: "status" | "inspect" | "triage";
  summary: ManifestSummary;
  manifestPath: string;
  gatesPath?: string;
  gateStatusesSummary: Record<string, { status: string; checked_at: string | null }>;
  extra?: Record<string, unknown>;
}): void {
  emitJson({
    ok: true,
    command: args.command,
    ...contractJson({
      summary: args.summary,
      manifestPath: args.manifestPath,
      gatesPath: args.gatesPath,
      gateStatusesSummary: args.gateStatusesSummary,
    }),
    ...(args.extra ?? {}),
  });
}
