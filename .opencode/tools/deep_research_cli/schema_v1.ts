import * as path from "node:path";

import type { GateId } from "./types";
import {
  assertEnum,
  errorWithPath,
  isFiniteNumber,
  isInteger,
  isNonEmptyString,
  isPlainObject,
} from "./utils";

export const MANIFEST_STATUS: string[] = ["created", "running", "paused", "failed", "completed", "cancelled"];
export const MANIFEST_MODE: string[] = ["quick", "standard", "deep"];
export const MANIFEST_STAGE: string[] = ["init", "perspectives", "wave1", "pivot", "wave2", "citations", "summaries", "synthesis", "review", "finalize"];

export const STAGE_TIMEOUT_SECONDS_V1: Record<string, number> = {
  init: 120,
  perspectives: 86400,
  wave1: 600,
  pivot: 120,
  wave2: 600,
  citations: 600,
  summaries: 600,
  synthesis: 600,
  review: 300,
  finalize: 120,
};

export const GATE_IDS = ["A", "B", "C", "D", "E", "F"] as const;
export const GAP_PRIORITY_VALUES = ["P0", "P1", "P2", "P3"] as const;

export const GAP_PRIORITY_RANK: Record<(typeof GAP_PRIORITY_VALUES)[number], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

// Source: .opencode/Plans/DeepResearchOptionC/spec-gate-escalation-v1.md
export const GATE_RETRY_CAPS_V1: Record<GateId, number> = {
  A: 0,
  B: 2,
  C: 1,
  D: 1,
  E: 3,
  F: 0,
};

// Phase 01: validate manifest + gates strongly enough to reject invalid examples.
export function validateManifestV1(value: unknown): string | null {
  if (!isPlainObject(value)) return errorWithPath("manifest must be an object", "$");
  const v = value;

  if (v.schema_version !== "manifest.v1") return errorWithPath("manifest.schema_version must be manifest.v1", "$.schema_version");
  if (!isNonEmptyString(v.run_id)) return errorWithPath("manifest.run_id missing", "$.run_id");
  if (!isNonEmptyString(v.created_at)) return errorWithPath("manifest.created_at missing", "$.created_at");
  if (!isNonEmptyString(v.updated_at)) return errorWithPath("manifest.updated_at missing", "$.updated_at");
  if (!isInteger(v.revision) || v.revision < 1) return errorWithPath("manifest.revision invalid", "$.revision");

  if (!isNonEmptyString(v.mode) || !assertEnum(v.mode, MANIFEST_MODE)) return errorWithPath("manifest.mode invalid", "$.mode");
  if (!isNonEmptyString(v.status) || !assertEnum(v.status, MANIFEST_STATUS)) return errorWithPath("manifest.status invalid", "$.status");

  if (!isPlainObject(v.query)) return errorWithPath("manifest.query missing", "$.query");
  if (!isNonEmptyString(v.query.text)) return errorWithPath("manifest.query.text missing", "$.query.text");
  if (v.query.constraints !== undefined && !isPlainObject(v.query.constraints)) {
    return errorWithPath("manifest.query.constraints must be object", "$.query.constraints");
  }
  if (v.query.sensitivity !== undefined) {
    if (!isNonEmptyString(v.query.sensitivity) || !assertEnum(v.query.sensitivity, ["normal", "restricted", "no_web"])) {
      return errorWithPath("manifest.query.sensitivity invalid", "$.query.sensitivity");
    }
  }

  if (!isPlainObject(v.stage)) return errorWithPath("manifest.stage missing", "$.stage");
  if (!isNonEmptyString(v.stage.current) || !assertEnum(v.stage.current, MANIFEST_STAGE)) {
    return errorWithPath("manifest.stage.current invalid", "$.stage.current");
  }
  if (!isNonEmptyString(v.stage.started_at)) return errorWithPath("manifest.stage.started_at missing", "$.stage.started_at");
  if (v.stage.last_progress_at !== undefined) {
    if (!isNonEmptyString(v.stage.last_progress_at)) {
      return errorWithPath("manifest.stage.last_progress_at must be non-empty string", "$.stage.last_progress_at");
    }
    const lastProgressAt = new Date(v.stage.last_progress_at);
    if (Number.isNaN(lastProgressAt.getTime())) {
      return errorWithPath("manifest.stage.last_progress_at must be valid ISO timestamp", "$.stage.last_progress_at");
    }
  }
  if (!Array.isArray(v.stage.history)) return errorWithPath("manifest.stage.history must be array", "$.stage.history");
  for (let i = 0; i < v.stage.history.length; i++) {
    const h = v.stage.history[i];
    if (!isPlainObject(h)) return errorWithPath("manifest.stage.history entry must be object", `$.stage.history[${i}]`);
    if (!isNonEmptyString(h.from)) return errorWithPath("stage.history.from missing", `$.stage.history[${i}].from`);
    if (!isNonEmptyString(h.to)) return errorWithPath("stage.history.to missing", `$.stage.history[${i}].to`);
    if (!isNonEmptyString(h.ts)) return errorWithPath("stage.history.ts missing", `$.stage.history[${i}].ts`);
    if (!isNonEmptyString(h.reason)) return errorWithPath("stage.history.reason missing", `$.stage.history[${i}].reason`);
    if (!isNonEmptyString(h.inputs_digest)) return errorWithPath("stage.history.inputs_digest missing", `$.stage.history[${i}].inputs_digest`);
    if (!isInteger(h.gates_revision)) return errorWithPath("stage.history.gates_revision invalid", `$.stage.history[${i}].gates_revision`);
  }

  if (!isPlainObject(v.limits)) return errorWithPath("manifest.limits missing", "$.limits");
  const limits = v.limits as Record<string, unknown>;
  for (const key of ["max_wave1_agents", "max_wave2_agents", "max_summary_kb", "max_total_summary_kb", "max_review_iterations"]) {
    if (!isFiniteNumber(limits[key])) return errorWithPath(`manifest.limits.${key} invalid`, `$.limits.${key}`);
  }

  if (!isPlainObject(v.artifacts)) return errorWithPath("manifest.artifacts missing", "$.artifacts");
  if (!isNonEmptyString(v.artifacts.root) || !path.isAbsolute(v.artifacts.root)) {
    return errorWithPath("manifest.artifacts.root must be absolute path", "$.artifacts.root");
  }
  if (!isPlainObject(v.artifacts.paths)) return errorWithPath("manifest.artifacts.paths missing", "$.artifacts.paths");
  const artifactPaths = v.artifacts.paths as Record<string, unknown>;
  for (const k of [
    "wave1_dir",
    "wave2_dir",
    "citations_dir",
    "summaries_dir",
    "synthesis_dir",
    "logs_dir",
    "gates_file",
    "perspectives_file",
    "citations_file",
    "summary_pack_file",
    "pivot_file",
  ]) {
    if (!isNonEmptyString(artifactPaths[k])) return errorWithPath(`manifest.artifacts.paths.${k} missing`, `$.artifacts.paths.${k}`);
  }

  if (!isPlainObject(v.metrics)) return errorWithPath("manifest.metrics must be object", "$.metrics");
  if (!Array.isArray(v.failures)) return errorWithPath("manifest.failures must be array", "$.failures");

  return null;
}

export function validateGatesV1(value: unknown): string | null {
  if (!isPlainObject(value)) return errorWithPath("gates must be an object", "$");
  const v = value;

  if (v.schema_version !== "gates.v1") return errorWithPath("gates.schema_version must be gates.v1", "$.schema_version");
  if (!isNonEmptyString(v.run_id)) return errorWithPath("gates.run_id missing", "$.run_id");
  if (!isInteger(v.revision) || v.revision < 1) return errorWithPath("gates.revision invalid", "$.revision");
  if (!isNonEmptyString(v.updated_at)) return errorWithPath("gates.updated_at missing", "$.updated_at");
  if (!isNonEmptyString(v.inputs_digest)) return errorWithPath("gates.inputs_digest missing", "$.inputs_digest");
  if (!isPlainObject(v.gates)) return errorWithPath("gates.gates missing", "$.gates");

  const requiredGateIds = ["A", "B", "C", "D", "E", "F"];
  const gatesObj = v.gates as Record<string, unknown>;
  for (const gateId of requiredGateIds) {
    if (!gatesObj[gateId]) return errorWithPath("missing required gate", `$.gates.${gateId}`);
  }

  for (const [gateId, gate] of Object.entries(v.gates)) {
    if (!isPlainObject(gate)) return errorWithPath("gate must be object", `$.gates.${gateId}`);
    if (gate.id !== gateId) return errorWithPath("gate.id must match key", `$.gates.${gateId}.id`);
    if (!isNonEmptyString(gate.name)) return errorWithPath("gate.name missing", `$.gates.${gateId}.name`);
    if (!isNonEmptyString(gate.class) || !assertEnum(gate.class, ["hard", "soft"])) {
      return errorWithPath("gate.class invalid", `$.gates.${gateId}.class`);
    }
    const allowedStatus = gate.class === "hard" ? ["not_run", "pass", "fail"] : ["not_run", "pass", "fail", "warn"];
    if (!isNonEmptyString(gate.status) || !assertEnum(gate.status, allowedStatus)) {
      return errorWithPath("gate.status invalid", `$.gates.${gateId}.status`);
    }
    if (gate.checked_at !== null && !isNonEmptyString(gate.checked_at)) {
      return errorWithPath("gate.checked_at must be string or null", `$.gates.${gateId}.checked_at`);
    }
    if (gate.status !== "not_run" && !isNonEmptyString(gate.checked_at)) {
      return errorWithPath("gate.checked_at required when status != not_run", `$.gates.${gateId}.checked_at`);
    }
    if (!isPlainObject(gate.metrics)) return errorWithPath("gate.metrics must be object", `$.gates.${gateId}.metrics`);
    if (!Array.isArray(gate.artifacts) || !gate.artifacts.every((x) => typeof x === "string")) {
      return errorWithPath("gate.artifacts must be string[]", `$.gates.${gateId}.artifacts`);
    }
    if (!Array.isArray(gate.warnings) || !gate.warnings.every((x) => typeof x === "string")) {
      return errorWithPath("gate.warnings must be string[]", `$.gates.${gateId}.warnings`);
    }
    if (typeof gate.notes !== "string") return errorWithPath("gate.notes must be string", `$.gates.${gateId}.notes`);
  }

  return null;
}

export function validatePerspectivesV1(value: unknown): string | null {
  if (!isPlainObject(value)) return errorWithPath("perspectives must be an object", "$");
  const v = value;

  if (v.schema_version !== "perspectives.v1") {
    return errorWithPath("perspectives.schema_version must be perspectives.v1", "$.schema_version");
  }
  if (!isNonEmptyString(v.run_id)) return errorWithPath("perspectives.run_id missing", "$.run_id");
  if (!isNonEmptyString(v.created_at)) return errorWithPath("perspectives.created_at missing", "$.created_at");
  if (!Array.isArray(v.perspectives)) return errorWithPath("perspectives.perspectives must be array", "$.perspectives");

  const allowedTracks = ["standard", "independent", "contrarian"];

  for (let i = 0; i < v.perspectives.length; i++) {
    const p = v.perspectives[i];
    if (!isPlainObject(p)) return errorWithPath("perspective must be object", `$.perspectives[${i}]`);
    if (!isNonEmptyString(p.id)) return errorWithPath("perspective.id missing", `$.perspectives[${i}].id`);
    if (!isNonEmptyString(p.title)) return errorWithPath("perspective.title missing", `$.perspectives[${i}].title`);
    if (!isNonEmptyString(p.track) || !assertEnum(p.track, allowedTracks)) {
      return errorWithPath("perspective.track invalid", `$.perspectives[${i}].track`);
    }
    if (!isNonEmptyString(p.agent_type)) {
      return errorWithPath("perspective.agent_type missing", `$.perspectives[${i}].agent_type`);
    }

    if (!isPlainObject(p.prompt_contract)) {
      return errorWithPath("perspective.prompt_contract must be object", `$.perspectives[${i}].prompt_contract`);
    }

    const c = p.prompt_contract;
    if (!isFiniteNumber(c.max_words)) {
      return errorWithPath("prompt_contract.max_words invalid", `$.perspectives[${i}].prompt_contract.max_words`);
    }
    if (!isFiniteNumber(c.max_sources)) {
      return errorWithPath("prompt_contract.max_sources invalid", `$.perspectives[${i}].prompt_contract.max_sources`);
    }
    if (!isPlainObject(c.tool_budget)) {
      return errorWithPath("prompt_contract.tool_budget must be object", `$.perspectives[${i}].prompt_contract.tool_budget`);
    }
    if (!Array.isArray(c.must_include_sections)) {
      return errorWithPath("prompt_contract.must_include_sections must be array", `$.perspectives[${i}].prompt_contract.must_include_sections`);
    }
    for (let j = 0; j < c.must_include_sections.length; j++) {
      if (!isNonEmptyString(c.must_include_sections[j])) {
        return errorWithPath(
          "prompt_contract.must_include_sections entries must be non-empty strings",
          `$.perspectives[${i}].prompt_contract.must_include_sections[${j}]`,
        );
      }
    }
  }

  return null;
}
