import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import { validateGatesV1, validateManifestV1 } from "./schema_v1";
import {
  err,
  errorCode,
  getNumberProp,
  isPlainObject,
  ok,
  readJson,
  sha256DigestForJson,
} from "./utils";
import { appendAuditJsonl, nowIso } from "./wave_tools_shared";
import { resolveRunRootFromManifest } from "./phase05_lib";

export const revision_control = tool({
  description: "Apply deterministic bounded review revision-control policy",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    gates_path: tool.schema.string().describe("Absolute path to gates.json"),
    review_bundle_path: tool.schema.string().describe("Absolute path to review-bundle.json"),
    current_iteration: tool.schema.number().describe("1-indexed current review iteration"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    gates_path: string;
    review_bundle_path: string;
    current_iteration: number;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const gatesPath = args.gates_path.trim();
      const reviewBundlePath = args.review_bundle_path.trim();
      const reason = args.reason.trim();
      const currentIteration = Math.trunc(args.current_iteration);

      if (!manifestPath || !path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      if (!gatesPath || !path.isAbsolute(gatesPath)) return err("INVALID_ARGS", "gates_path must be absolute", { gates_path: args.gates_path });
      if (!reviewBundlePath || !path.isAbsolute(reviewBundlePath)) {
        return err("INVALID_ARGS", "review_bundle_path must be absolute", { review_bundle_path: args.review_bundle_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");
      if (!Number.isInteger(currentIteration) || currentIteration <= 0) {
        return err("INVALID_ARGS", "current_iteration must be positive integer", { current_iteration: args.current_iteration });
      }

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;
      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);

      const gatesRaw = await readJson(gatesPath);
      const gErr = validateGatesV1(gatesRaw);
      if (gErr) return gErr;
      const gatesDoc = gatesRaw as Record<string, unknown>;
      const gatesObj = isPlainObject(gatesDoc.gates) ? (gatesDoc.gates as Record<string, unknown>) : {};
      const gateE = isPlainObject(gatesObj.E) ? (gatesObj.E as Record<string, unknown>) : {};
      const gateEStatus = String(gateE.status ?? "").trim();

      const reviewRaw = await readJson(reviewBundlePath);
      if (!isPlainObject(reviewRaw)) return err("SCHEMA_VALIDATION_FAILED", "review bundle must be object");
      const reviewDoc = reviewRaw as Record<string, unknown>;
      const decision = String(reviewDoc.decision ?? "").trim();
      if (decision !== "PASS" && decision !== "CHANGES_REQUIRED") {
        return err("SCHEMA_VALIDATION_FAILED", "review bundle decision invalid", { decision });
      }

      const limitsObj = isPlainObject(manifest.limits) ? (manifest.limits as Record<string, unknown>) : {};
      const maxReviewIterations = getNumberProp(limitsObj, "max_review_iterations") ?? Number(limitsObj.max_review_iterations ?? 0);
      if (!Number.isFinite(maxReviewIterations) || maxReviewIterations < 0) {
        return err("INVALID_STATE", "manifest.limits.max_review_iterations invalid", {
          value: limitsObj.max_review_iterations ?? null,
        });
      }

      let action: "advance" | "revise" | "escalate";
      let nextStage: "finalize" | "synthesis" | "review";
      let notes: string;

      if (decision === "PASS" && gateEStatus === "pass") {
        action = "advance";
        nextStage = "finalize";
        notes = "Review passed and Gate E hard metrics passed";
      } else if (currentIteration >= maxReviewIterations) {
        action = "escalate";
        nextStage = "review";
        notes = `Max review iterations reached (${currentIteration}/${maxReviewIterations})`;
      } else {
        action = "revise";
        nextStage = "synthesis";
        notes = decision === "CHANGES_REQUIRED"
          ? "Reviewer requested changes within iteration budget"
          : "Gate E not pass; revise synthesis within iteration budget";
      }

      const inputsDigest = sha256DigestForJson({
        schema: "revision_control.inputs.v1",
        run_id: runId,
        decision,
        gate_e_status: gateEStatus,
        current_iteration: currentIteration,
        max_review_iterations: maxReviewIterations,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "revision_control",
            run_id: runId,
            reason,
            action,
            next_stage: nextStage,
            decision,
            gate_e_status: gateEStatus,
            current_iteration: currentIteration,
            max_review_iterations: maxReviewIterations,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort
      }

      return ok({
        action,
        next_stage: nextStage,
        notes,
        inputs_digest: inputsDigest,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "revision_control failed", { message: String(e) });
    }
  },
});

export const deep_research_revision_control = revision_control;
