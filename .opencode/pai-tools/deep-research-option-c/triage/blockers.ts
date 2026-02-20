import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { stage_advance } from "../../../tools/deep_research.ts";
import {
  asObject,
  readJsonObject,
} from "../lib/io-json";
import { makeToolContext } from "../runtime/tool-context";
import {
  parseToolEnvelope,
  type ToolEnvelope,
  type ToolWithExecute,
} from "../runtime/tool-envelope";

export type TriageBlockers = {
  from: string;
  to: string;
  errorCode: string | null;
  errorMessage: string | null;
  missingArtifacts: Array<{ name: string; path: string | null }>;
  blockedGates: Array<{ gate: string; status: string | null }>;
  failedChecks: Array<{ kind: string; name: string }>;
  allowed: boolean;
};

export type BlockedUrlsInspectSummary = {
  artifactPath: string;
  total: number;
  byStatus: Array<{ status: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
};

export function blockersSummaryJson(triage: TriageBlockers): {
  missing_artifacts: Array<{ name: string; path: string | null }>;
  blocked_gates: Array<{ gate: string; status: string | null }>;
} {
  return {
    missing_artifacts: triage.missingArtifacts.map((item) => ({
      name: item.name,
      path: item.path,
    })),
    blocked_gates: triage.blockedGates.map((item) => ({
      gate: item.gate,
      status: item.status,
    })),
  };
}

export async function stageAdvanceDryRun(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
}): Promise<ToolEnvelope> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dr-stage-advance-"));
  const tempManifest = path.join(tempDir, "manifest.json");
  const tempGates = path.join(tempDir, "gates.json");

  try {
    await fs.copyFile(args.manifestPath, tempManifest);
    await fs.copyFile(args.gatesPath, tempGates);
    const raw = await (stage_advance as unknown as ToolWithExecute).execute(
      {
        manifest_path: tempManifest,
        gates_path: tempGates,
        reason: args.reason,
      },
      makeToolContext(),
    );
    return parseToolEnvelope("stage_advance", raw);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export function triageFromStageAdvanceResult(envelope: ToolEnvelope): TriageBlockers {
  const error = asObject(envelope.error);
  const errorDetails = asObject(error.details);
  const decision = asObject(errorDetails.decision);
  const evaluated = Array.isArray(decision.evaluated)
    ? (decision.evaluated as Array<Record<string, unknown>>)
    : [];

  const missingArtifacts: Array<{ name: string; path: string | null }> = [];
  const blockedGates: Array<{ gate: string; status: string | null }> = [];
  const failedChecks: Array<{ kind: string; name: string }> = [];

  for (const item of evaluated) {
    if (item.ok === true) continue;
    const kind = String(item.kind ?? "unknown");
    const name = String(item.name ?? "unknown");
    const details = asObject(item.details);

    if (kind === "artifact") {
      missingArtifacts.push({
        name,
        path: details.path == null ? null : String(details.path),
      });
      continue;
    }

    if (kind === "gate") {
      blockedGates.push({
        gate: String(details.gate ?? name),
        status: details.status == null ? null : String(details.status),
      });
      continue;
    }

    failedChecks.push({ kind, name });
  }

  if (envelope.ok === true) {
    return {
      from: String(envelope.from ?? ""),
      to: String(envelope.to ?? ""),
      errorCode: null,
      errorMessage: null,
      missingArtifacts,
      blockedGates,
      failedChecks,
      allowed: true,
    };
  }

  return {
    from: String(errorDetails.from ?? ""),
    to: String(errorDetails.to ?? ""),
    errorCode: error.code == null ? null : String(error.code),
    errorMessage: error.message == null ? null : String(error.message),
    missingArtifacts,
    blockedGates,
    failedChecks,
    allowed: false,
  };
}

export function printBlockersSummary(triage: TriageBlockers): void {
  console.log("blockers.summary:");
  console.log(`  transition: ${triage.from || "?"} -> ${triage.to || "?"}`);

  if (triage.allowed) {
    console.log("  status: no transition blockers detected");
    console.log("  remediation: inspect tick error details for non-stage failures");
    return;
  }

  if (triage.errorCode || triage.errorMessage) {
    console.log(`  error: ${triage.errorCode ?? "UNKNOWN"} ${triage.errorMessage ?? ""}`.trim());
  }

  if (triage.missingArtifacts.length > 0) {
    console.log("  missing_artifacts:");
    for (const item of triage.missingArtifacts) {
      console.log(`    - ${item.name}${item.path ? ` (${item.path})` : ""}`);
    }
  }

  if (triage.blockedGates.length > 0) {
    console.log("  blocked_gates:");
    for (const gate of triage.blockedGates) {
      console.log(`    - ${gate.gate} (status=${gate.status ?? "unknown"})`);
    }
  }

  if (triage.failedChecks.length > 0) {
    console.log("  failed_checks:");
    for (const check of triage.failedChecks) {
      console.log(`    - ${check.kind}: ${check.name}`);
    }
  }

  console.log("  remediation: run inspect for full guidance and produce required artifacts/gate passes");
}

export async function computeTriageBlockers(args: {
  manifestPath: string;
  gatesPath: string;
  reason: string;
}): Promise<TriageBlockers | null> {
  try {
    const dryRun = await stageAdvanceDryRun({
      manifestPath: args.manifestPath,
      gatesPath: args.gatesPath,
      reason: args.reason,
    });
    return triageFromStageAdvanceResult(dryRun);
  } catch {
    return null;
  }
}

export async function readBlockedUrlsInspectSummary(runRoot: string): Promise<BlockedUrlsInspectSummary | null> {
  const blockedUrlsPath = path.join(runRoot, "citations", "blocked-urls.json");

  let raw: Record<string, unknown>;
  try {
    raw = await readJsonObject(blockedUrlsPath);
  } catch {
    return null;
  }

  const items = Array.isArray(raw.items) ? raw.items : [];
  const statusCounts = new Map<string, number>();
  const actionCounts = new Map<string, number>();

  for (const item of items) {
    const obj = asObject(item);
    const status = String(obj.status ?? "blocked").trim() || "blocked";
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

    const action = String(obj.action ?? "").trim();
    if (action) {
      actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
    }
  }

  const byStatus = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => a.status.localeCompare(b.status));

  const topActions = Array.from(actionCounts.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action))
    .slice(0, 5);

  return {
    artifactPath: blockedUrlsPath,
    total: items.length,
    byStatus,
    topActions,
  };
}
