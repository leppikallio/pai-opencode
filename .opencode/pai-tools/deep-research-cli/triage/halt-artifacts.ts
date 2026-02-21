import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  readJsonObject,
} from "../utils/io-json";
import {
  atomicWriteUtf8,
} from "../../../tools/deep_research_cli/lifecycle_lib";
import {
  safeResolveManifestPath,
} from "../utils/paths";
import {
  resolveDeepResearchCliInvocation,
} from "../utils/cli-invocation";
import {
  computeTriageBlockers,
  printBlockersSummary,
  type TriageBlockers,
} from "./blockers";

export type HaltRelatedPaths = {
  manifest_path: string;
  gates_path: string;
  retry_directives_path?: string;
  blocked_urls_path?: string;
  online_fixtures_latest_path?: string;
};

export type HaltArtifactV1 = {
  schema_version: "halt.v1";
  created_at: string;
  run_id: string;
  run_root: string;
  tick_index: number;
  stage_current: string;
  blocked_transition: { from: string; to: string };
  error: { code: string; message: string; details?: Record<string, unknown> };
  blockers: {
    missing_artifacts: Array<{ name: string; path?: string }>;
    blocked_gates: Array<{ gate: string; status?: string }>;
    failed_checks: Array<{ kind: string; name: string }>;
  };
  related_paths: HaltRelatedPaths;
  next_commands: string[];
  notes: string;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return false;
    throw error;
  }
}

async function nextHaltTickIndex(haltDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(haltDir);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return 1;
    throw error;
  }

  let maxTick = 0;
  for (const entry of entries) {
    const match = /^tick-(\d+)\.json$/u.exec(entry);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (value > maxTick) maxTick = value;
  }
  return maxTick + 1;
}

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return await readJsonObject(filePath);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export async function resolveLatestOnlineFixtures(runRoot: string): Promise<string | null> {
  const latestPointerPath = await safeResolveManifestPath(
    runRoot,
    "citations/online-fixtures.latest.json",
    "citations.online_fixtures.latest",
  );
  const latestPointer = await readJsonIfExists(latestPointerPath);
  if (latestPointer) {
    const candidateRaw = String(latestPointer.path ?? latestPointer.latest_path ?? "").trim();
    if (candidateRaw) {
      return await safeResolveManifestPath(runRoot, candidateRaw, "citations.online_fixtures.path");
    }
    return latestPointerPath;
  }

  const citationsDir = await safeResolveManifestPath(runRoot, "citations", "citations.dir");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(citationsDir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((entry) => /^online-fixtures\.[^.]+\.json$/u.test(entry))
    .sort();
  if (candidates.length === 0) return null;
  return path.join(citationsDir, candidates[candidates.length - 1]);
}

async function resolveHaltRelatedPaths(args: {
  runRoot: string;
  manifestPath: string;
  gatesPath: string;
}): Promise<HaltRelatedPaths> {
  const related: HaltRelatedPaths = {
    manifest_path: args.manifestPath,
    gates_path: args.gatesPath,
  };

  const retryDirectivesPath = await safeResolveManifestPath(args.runRoot, "retry/retry-directives.json", "retry.retry_directives");
  if (await fileExists(retryDirectivesPath)) {
    related.retry_directives_path = retryDirectivesPath;
  }

  const blockedUrlsPath = await safeResolveManifestPath(args.runRoot, "citations/blocked-urls.json", "citations.blocked_urls");
  if (await fileExists(blockedUrlsPath)) {
    related.blocked_urls_path = blockedUrlsPath;
  }

  const latestOnlineFixturesPath = await resolveLatestOnlineFixtures(args.runRoot);
  if (latestOnlineFixturesPath) {
    related.online_fixtures_latest_path = latestOnlineFixturesPath;
  }

  return related;
}

function nextHaltCommands(args: {
  manifestPath: string;
  stageCurrent: string;
  tickIndex: number;
  nextStepCliInvocation: () => string;
  nextCommandsOverride?: string[];
}): string[] {
  if (Array.isArray(args.nextCommandsOverride) && args.nextCommandsOverride.length > 0) {
    return args.nextCommandsOverride;
  }
  const cli = resolveDeepResearchCliInvocation();
  return [
    `${cli} inspect --manifest "${args.manifestPath}"`,
    `${cli} triage --manifest "${args.manifestPath}"`,
    `${cli} tick --manifest "${args.manifestPath}" --driver fixture --reason "halt retry from ${args.stageCurrent} (halt_tick_${args.tickIndex})"`,
  ];
}

export async function writeHaltArtifact(args: {
  runRoot: string;
  runId: string;
  manifestPath: string;
  gatesPath: string;
  stageCurrent: string;
  reason: string;
  error: { code: string; message: string; details?: Record<string, unknown> };
  triage: TriageBlockers | null;
  nextStepCliInvocation: () => string;
  nextCommandsOverride?: string[];
}): Promise<{ tickPath: string; latestPath: string; tickIndex: number; nextCommands: string[] }> {
  const haltDir = path.join(args.runRoot, "operator", "halt");
  await fs.mkdir(haltDir, { recursive: true });

  const tickIndex = await nextHaltTickIndex(haltDir);
  const padded = String(tickIndex).padStart(4, "0");
  const tickPath = path.join(haltDir, `tick-${padded}.json`);
  const latestPath = path.join(haltDir, "latest.json");
  const relatedPaths = await resolveHaltRelatedPaths({
    runRoot: args.runRoot,
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
  });

  const triage = args.triage;
  const artifact: HaltArtifactV1 = {
    schema_version: "halt.v1",
    created_at: new Date().toISOString(),
    run_id: args.runId,
    run_root: args.runRoot,
    tick_index: tickIndex,
    stage_current: args.stageCurrent,
    blocked_transition: {
      from: triage?.from || args.stageCurrent,
      to: triage?.to || args.stageCurrent,
    },
    error: {
      code: args.error.code,
      message: args.error.message,
      ...(args.error.details ? { details: args.error.details } : {}),
    },
    blockers: {
      missing_artifacts: (triage?.missingArtifacts ?? []).map((item) => ({
        name: item.name,
        ...(item.path ? { path: item.path } : {}),
      })),
      blocked_gates: (triage?.blockedGates ?? []).map((item) => ({
        gate: item.gate,
        ...(item.status ? { status: item.status } : {}),
      })),
      failed_checks: (triage?.failedChecks ?? []).map((item) => ({
        kind: item.kind,
        name: item.name,
      })),
    },
    related_paths: relatedPaths,
    next_commands: nextHaltCommands({
      manifestPath: args.manifestPath,
      stageCurrent: args.stageCurrent,
      tickIndex,
      nextStepCliInvocation: args.nextStepCliInvocation,
      nextCommandsOverride: args.nextCommandsOverride,
    }),
    notes: `Tick failure captured by operator CLI (${args.reason})`,
  };

  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  await atomicWriteUtf8(tickPath, serialized);
  await atomicWriteUtf8(latestPath, serialized);

  return {
    tickPath,
    latestPath,
    tickIndex,
    nextCommands: artifact.next_commands,
  };
}

export async function writeHaltArtifactForFailure(args: {
  runRoot: string;
  runId: string;
  stageCurrent: string;
  manifestPath: string;
  gatesPath: string;
  reason: string;
  error: { code: string; message: string; details?: Record<string, unknown> };
  nextStepCliInvocation: () => string;
  nextCommandsOverride?: string[];
}): Promise<{ tickPath: string; latestPath: string; tickIndex: number; nextCommands: string[]; triage: TriageBlockers | null }> {
  const triage = await computeTriageBlockers({
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    reason: `${args.reason} [halt_triage]`,
  });

  const halt = await writeHaltArtifact({
    runRoot: args.runRoot,
    runId: args.runId,
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    stageCurrent: args.stageCurrent,
    reason: args.reason,
    error: args.error,
    triage,
    nextStepCliInvocation: args.nextStepCliInvocation,
    nextCommandsOverride: args.nextCommandsOverride,
  });

  return { ...halt, triage };
}

export async function printAutoTriage(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
  triage?: TriageBlockers | null;
}): Promise<void> {
  const triage = args.triage ?? await computeTriageBlockers({
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    reason: args.reason,
  });

  if (triage) {
    printBlockersSummary(triage);
    return;
  }

  console.log("blockers.summary:");
  console.log("  unavailable: stage_advance dry-run failed");
}

export async function printHaltArtifactSummary(args: {
  tickPath: string;
  latestPath: string;
  tickIndex: number;
}): Promise<void> {
  console.log(`halt.tick_index: ${args.tickIndex}`);
  console.log(`halt.path: ${args.tickPath}`);
  console.log(`halt.latest_path: ${args.latestPath}`);
}

export async function handleTickFailureArtifacts(args: {
  runRoot: string;
  runId: string;
  stageCurrent: string;
  manifestPath: string;
  gatesPath: string;
  reason: string;
  error: { code: string; message: string; details?: Record<string, unknown> };
  triageReason: string;
  nextStepCliInvocation: () => string;
  nextCommandsOverride?: string[];
  emitLogs?: boolean;
}): Promise<{ tickPath: string; latestPath: string; tickIndex: number; nextCommands: string[]; triage: TriageBlockers | null }> {
  const halt = await writeHaltArtifactForFailure({
    runRoot: args.runRoot,
    runId: args.runId,
    stageCurrent: args.stageCurrent,
    manifestPath: args.manifestPath,
    gatesPath: args.gatesPath,
    reason: args.reason,
    error: args.error,
    nextStepCliInvocation: args.nextStepCliInvocation,
    nextCommandsOverride: args.nextCommandsOverride,
  });

  if (args.emitLogs !== false) {
    await printHaltArtifactSummary(halt);
    await printAutoTriage({
      manifestPath: args.manifestPath,
      gatesPath: args.gatesPath,
      reason: args.triageReason,
      triage: halt.triage,
    });
  }

  return halt;
}
