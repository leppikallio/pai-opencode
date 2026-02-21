import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  type ToolWithExecute,
  err,
  errorCode,
  exists,
  getManifestArtifacts,
  getManifestPaths,
  getStringProp,
  isPlainObject,
  nowIso,
  ok,
  parseJsonSafe,
  readJson,
  sha256HexLowerUtf8,
  validateGatesV1,
  validateManifestV1,
} from "./lifecycle_lib";
import { manifest_write } from "./manifest_write";

export const stage_advance = tool({
  description: "Advance deep research stage deterministically (Phase 02)",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    gates_path: tool.schema.string().describe("Absolute path to gates.json"),
    requested_next: tool.schema.string().optional().describe("Optional target stage"),
    expected_manifest_revision: tool.schema.number().optional().describe("Optional optimistic lock for manifest revision"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; gates_path: string; requested_next?: string; expected_manifest_revision?: number; reason: string }) {
    try {
      const manifestRaw = await readJson(args.manifest_path);
      const gatesRaw = await readJson(args.gates_path);

      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;
      const gErr = validateGatesV1(gatesRaw);
      if (gErr) return gErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const gatesDoc = gatesRaw as Record<string, unknown>;
      const manifestRevision = Number(manifest.revision ?? Number.NaN);
      if (!Number.isFinite(manifestRevision)) {
        return err("INVALID_STATE", "manifest.revision invalid", {
          revision: manifest.revision ?? null,
        });
      }
      if (typeof args.expected_manifest_revision === "number" && args.expected_manifest_revision !== manifestRevision) {
        return err("REVISION_MISMATCH", "expected_manifest_revision mismatch", {
          expected: args.expected_manifest_revision,
          got: manifestRevision,
        });
      }

      const query = isPlainObject(manifest.query) ? (manifest.query as Record<string, unknown>) : null;
      const constraints = query && isPlainObject(query.constraints)
        ? (query.constraints as Record<string, unknown>)
        : null;
      const optionC = constraints && isPlainObject(constraints.deep_research_cli)
        ? (constraints.deep_research_cli as Record<string, unknown>)
        : null;
      if (optionC?.enabled === false) {
        return err("DISABLED", "Option C is disabled", {
          constraint_path: "manifest.query.constraints.deep_research_cli.enabled",
          instruction: "No env vars required; use CLI flags and run artifacts.",
        });
      }

      const stageObj = isPlainObject(manifest.stage) ? (manifest.stage as Record<string, unknown>) : {};
      const from = String(stageObj.current ?? "");
      const allowedStages = ["init", "perspectives", "wave1", "pivot", "wave2", "citations", "summaries", "synthesis", "review", "finalize"] as const;
      if (!from || !allowedStages.includes(from as (typeof allowedStages)[number])) {
        return err("INVALID_STATE", "stage not recognized", { stage: from });
      }

      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? "");
      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "manifest.artifacts.root invalid", { root: runRoot });
      }

      const paths = getManifestPaths(manifest);
      const wave1Dir = String(paths.wave1_dir ?? "wave-1");
      const wave2Dir = String(paths.wave2_dir ?? "wave-2");
      const citationsFile = String(paths.citations_file ?? "citations/citations.jsonl");
      const synthesisDir = String(paths.synthesis_dir ?? "synthesis");
      const perspectivesFile = String(paths.perspectives_file ?? "perspectives.json");
      const pivotFile = String(paths.pivot_file ?? "pivot.json");
      const waveReviewFile = String(paths.wave_review_report_file ?? "wave-review.json");
      const summaryPackFile = String(paths.summary_pack_file ?? "summaries/summary-pack.json");
      const reviewBundleFile = String(paths.review_bundle_file ?? "review/review-bundle.json");

      const gates = isPlainObject(gatesDoc.gates) ? (gatesDoc.gates as Record<string, unknown>) : {};
      const gatesRevision = Number(gatesDoc.revision ?? 0);

      const evaluated: Array<{ kind: string; name: string; ok: boolean; details: Record<string, unknown> }> = [];

      const evalArtifact = async (name: string, absPath: string) => {
        const okv = await exists(absPath);
        evaluated.push({ kind: "artifact", name, ok: okv, details: { path: absPath } });
        return okv;
      };

      const evalGatePass = (gateId: string) => {
        const gate = isPlainObject(gates[gateId]) ? (gates[gateId] as Record<string, unknown>) : null;
        const status = gate ? gate.status : undefined;
        const okv = status === "pass";
        evaluated.push({ kind: "gate", name: `Gate ${gateId}`, ok: okv, details: { gate: gateId, status: status ?? null } });
        return okv;
      };

      const evalDirHasFiles = async (name: string, absDir: string) => {
        let okv = false;
        let count = 0;
        try {
          const entries = await fs.promises.readdir(absDir);
          const filtered = entries.filter((x) => !x.startsWith("."));
          count = filtered.length;
          okv = count > 0;
        } catch {
          okv = false;
        }
        evaluated.push({ kind: "artifact", name, ok: okv, details: { path: absDir, count } });
        return okv;
      };

      const parsePivotRunWave2 = async (): Promise<{ ok: boolean; run_wave2: boolean; wave2_gap_ids: string[]; error?: string }> => {
        const p = path.join(runRoot, pivotFile);
        if (!(await exists(p))) {
          return { ok: false, run_wave2: false, wave2_gap_ids: [], error: "pivot.json missing" };
        }
        try {
          const raw = await fs.promises.readFile(p, "utf8");
          const v = JSON.parse(raw);
          if (!v || typeof v !== "object") return { ok: false, run_wave2: false, wave2_gap_ids: [], error: "pivot not object" };
          const vObj = isPlainObject(v) ? (v as Record<string, unknown>) : null;
          const decisionObj = vObj && isPlainObject(vObj.decision) ? (vObj.decision as Record<string, unknown>) : null;
          const decisionFlag = decisionObj ? decisionObj.wave2_required : undefined;
          const legacyFlag = vObj ? vObj.run_wave2 : undefined;
          const flag = typeof decisionFlag === "boolean" ? decisionFlag : legacyFlag;
          if (typeof flag !== "boolean") return { ok: false, run_wave2: false, wave2_gap_ids: [], error: "pivot.run_wave2 missing" };

          const decisionGapIds = decisionObj ? decisionObj.wave2_gap_ids : undefined;
          const legacyGapIds = vObj ? vObj.wave2_gap_ids : undefined;
          const gapIdsRaw = Array.isArray(decisionGapIds)
            ? decisionGapIds
            : Array.isArray(legacyGapIds)
              ? legacyGapIds
              : [];
          if (!gapIdsRaw.every((x) => typeof x === "string")) {
            return { ok: false, run_wave2: false, wave2_gap_ids: [], error: "pivot.wave2_gap_ids invalid" };
          }

          return { ok: true, run_wave2: flag, wave2_gap_ids: gapIdsRaw };
        } catch (e) {
          return { ok: false, run_wave2: false, wave2_gap_ids: [], error: String(e) };
        }
      };

      const parseReviewDecision = async (): Promise<{
        ok: boolean;
        decision: "PASS" | "CHANGES_REQUIRED" | null;
        error?: string;
      }> => {
        const p = path.join(runRoot, reviewBundleFile);
        if (!(await exists(p))) {
          return { ok: false, decision: null, error: "review-bundle.json missing" };
        }
        try {
          const raw = await fs.promises.readFile(p, "utf8");
          const v = JSON.parse(raw);
          if (!v || typeof v !== "object") return { ok: false, decision: null, error: "review bundle not object" };
          const vObj = isPlainObject(v) ? (v as Record<string, unknown>) : null;
          const decision = String(vObj?.decision ?? "").trim();
          if (decision !== "PASS" && decision !== "CHANGES_REQUIRED") {
            return { ok: false, decision: null, error: "review decision invalid" };
          }
          return { ok: true, decision };
        } catch (e) {
          return { ok: false, decision: null, error: String(e) };
        }
      };

      const countReviewToSynthesisTransitions = (): number => {
        const history = Array.isArray(stageObj.history) ? stageObj.history : [];
        let count = 0;
        for (const entry of history) {
          if (!isPlainObject(entry)) continue;
          const fromStage = String(entry.from ?? "");
          const toStage = String(entry.to ?? "");
          if (fromStage === "review" && toStage === "synthesis") count += 1;
        }
        return count;
      };

      const allowedNextFor = (stage: string): string[] => {
        switch (stage) {
          case "init": return ["perspectives", "wave1"];
          case "perspectives": return ["wave1"];
          case "wave1": return ["pivot"];
          case "pivot": return ["wave2", "citations"];
          case "wave2": return ["citations"];
          case "citations": return ["summaries"];
          case "summaries": return ["synthesis"];
          case "synthesis": return ["review"];
          case "review": return ["synthesis", "finalize"];
          case "finalize": return [];
          default: return [];
        }
      };

      if (from === "finalize") {
        return err("INVALID_STATE", "already finalized", { stage: from });
      }

      const allowedNext = allowedNextFor(from);
      const requested = (args.requested_next ?? "").trim();
      const toCandidate = requested || "";

      let to: string;
      let pivotForTransition: Awaited<ReturnType<typeof parsePivotRunWave2>> | null = null;
      let reviewForTransition: Awaited<ReturnType<typeof parseReviewDecision>> | null = null;

      if (requested) {
        if (!allowedStages.includes(requested as (typeof allowedStages)[number])) {
          return err("REQUESTED_NEXT_NOT_ALLOWED", "requested_next is not a stage", { requested_next: requested });
        }
        if (!allowedNext.includes(requested)) {
          return err("REQUESTED_NEXT_NOT_ALLOWED", "requested_next not allowed from current stage", {
            from,
            requested_next: requested,
            allowed_next: allowedNext,
          });
        }
        to = requested;
      } else {
        if (from === "pivot") {
          const pivot = await parsePivotRunWave2();
          pivotForTransition = pivot;
          evaluated.push({
            kind: "artifact",
            name: pivotFile,
            ok: pivot.ok,
            details: {
              path: path.join(runRoot, pivotFile),
              run_wave2: pivot.run_wave2,
              wave2_gap_count: pivot.wave2_gap_ids.length,
              error: pivot.error ?? null,
            },
          });
          if (!pivot.ok) {
            return err("MISSING_ARTIFACT", "pivot decision incomplete", { file: pivotFile });
          }
          to = pivot.run_wave2 ? "wave2" : "citations";
        } else if (from === "review") {
          const review = await parseReviewDecision();
          reviewForTransition = review;
          evaluated.push({
            kind: "artifact",
            name: reviewBundleFile,
            ok: review.ok,
            details: {
              path: path.join(runRoot, reviewBundleFile),
              decision: review.decision,
              error: review.error ?? null,
            },
          });
          if (!review.ok) {
            return err("MISSING_ARTIFACT", "review decision incomplete", { file: reviewBundleFile });
          }
          to = review.decision === "PASS" ? "finalize" : "synthesis";
        } else if (from === "init") {
          // Backward-compatible default for callers that do not pass requested_next.
          to = "wave1";
        } else if (allowedNext.length === 1) {
          to = allowedNext[0];
        } else {
          return err("INVALID_STATE", "ambiguous transition; requested_next required", { from, allowed_next: allowedNext });
        }
      }

      evaluated.push({ kind: "transition", name: `${from} -> ${to}`, ok: true, details: {} });

      type StageAdvanceBlock = { code: string; message: string; details: Record<string, unknown> };
      let block: StageAdvanceBlock | null = null;

      const blockIfFailed = (
        okv: boolean,
        code: string,
        message: string,
        details: Record<string, unknown>,
      ): StageAdvanceBlock | null => {
        if (okv) return null;
        return { code, message, details };
      };

      if ((from === "init" || from === "perspectives") && to === "wave1") {
        block ??= blockIfFailed(await evalArtifact(perspectivesFile, path.join(runRoot, perspectivesFile)), "MISSING_ARTIFACT", "perspectives.json missing", { file: perspectivesFile });
      }

      if (from === "wave1" && to === "pivot") {
        block ??= blockIfFailed(await evalDirHasFiles(wave1Dir, path.join(runRoot, wave1Dir)), "MISSING_ARTIFACT", "wave1 artifacts missing", { dir: wave1Dir });
        block ??= blockIfFailed(
          await evalArtifact(waveReviewFile, path.join(runRoot, waveReviewFile)),
          "MISSING_ARTIFACT",
          "wave-review.json missing",
          { file: waveReviewFile },
        );
        block ??= blockIfFailed(evalGatePass("B"), "GATE_BLOCKED", "Gate B not pass", { gate: "B" });
      }

      if (from === "pivot" && to === "wave2") {
        await evalArtifact(wave2Dir, path.join(runRoot, wave2Dir));

        if (!pivotForTransition) {
          pivotForTransition = await parsePivotRunWave2();
          evaluated.push({
            kind: "artifact",
            name: pivotFile,
            ok: pivotForTransition.ok,
            details: {
              path: path.join(runRoot, pivotFile),
              run_wave2: pivotForTransition.run_wave2,
              wave2_gap_count: pivotForTransition.wave2_gap_ids.length,
              error: pivotForTransition.error ?? null,
            },
          });
        }

        block ??= blockIfFailed(
          pivotForTransition.ok,
          "MISSING_ARTIFACT",
          "pivot decision incomplete",
          { file: pivotFile },
        );

        if (!block && pivotForTransition.run_wave2) {
          const limitsObj = isPlainObject(manifest.limits) ? (manifest.limits as Record<string, unknown>) : {};
          const capRaw = limitsObj.max_wave2_agents;
          const cap = typeof capRaw === "number" && Number.isFinite(capRaw) ? Math.trunc(capRaw) : 0;
          const count = pivotForTransition.wave2_gap_ids.length;
          const capOk = count <= cap;
          evaluated.push({
            kind: "limit",
            name: "wave2_gap_ids <= max_wave2_agents",
            ok: capOk,
            details: { stage: "wave2", cap, count },
          });
          block ??= blockIfFailed(
            capOk,
            "WAVE_CAP_EXCEEDED",
            "wave2 gap ids exceed manifest limit",
            { cap, count, stage: "wave2" },
          );
        }
      }

      if (from === "pivot" && to === "citations") {
        if (!pivotForTransition) {
          pivotForTransition = await parsePivotRunWave2();
          evaluated.push({
            kind: "artifact",
            name: pivotFile,
            ok: pivotForTransition.ok,
            details: {
              path: path.join(runRoot, pivotFile),
              run_wave2: pivotForTransition.run_wave2,
              wave2_gap_count: pivotForTransition.wave2_gap_ids.length,
              error: pivotForTransition.error ?? null,
            },
          });
        }

        block ??= blockIfFailed(
          pivotForTransition.ok,
          "MISSING_ARTIFACT",
          "pivot decision incomplete",
          { file: pivotFile },
        );

        if (!block) {
          const skipWave2 = !pivotForTransition.run_wave2;
          evaluated.push({
            kind: "policy",
            name: "pivot requires citations only when wave2 is skipped",
            ok: skipWave2,
            details: {
              run_wave2: pivotForTransition.run_wave2,
            },
          });
          block ??= blockIfFailed(
            skipWave2,
            "REQUESTED_NEXT_NOT_ALLOWED",
            "pivot requires wave2; citations transition not allowed",
            { requested_next: requested || null, run_wave2: pivotForTransition.run_wave2 },
          );
        }
      }

      if (from === "wave2" && to === "citations") {
        block ??= blockIfFailed(await evalDirHasFiles(wave2Dir, path.join(runRoot, wave2Dir)), "MISSING_ARTIFACT", "wave2 artifacts missing", { dir: wave2Dir });
      }

      if (from === "citations" && to === "summaries") {
        block ??= blockIfFailed(evalGatePass("C"), "GATE_BLOCKED", "Gate C not pass", { gate: "C" });
        block ??= blockIfFailed(
          await evalArtifact(citationsFile, path.join(runRoot, citationsFile)),
          "MISSING_ARTIFACT",
          "citations.jsonl missing",
          { file: citationsFile },
        );
      }

      if (from === "summaries" && to === "synthesis") {
        block ??= blockIfFailed(evalGatePass("D"), "GATE_BLOCKED", "Gate D not pass", { gate: "D" });
        block ??= blockIfFailed(await evalArtifact(summaryPackFile, path.join(runRoot, summaryPackFile)), "MISSING_ARTIFACT", "summary-pack.json missing", { file: summaryPackFile });
      }

      if (from === "synthesis" && to === "review") {
        const finalSynthesis = path.join(runRoot, synthesisDir, "final-synthesis.md");
        block ??= blockIfFailed(await evalArtifact(`${synthesisDir}/final-synthesis.md`, finalSynthesis), "MISSING_ARTIFACT", "final-synthesis.md missing", { file: `${synthesisDir}/final-synthesis.md` });
      }

      if (from === "review" && to === "synthesis") {
        if (!reviewForTransition) {
          reviewForTransition = await parseReviewDecision();
          evaluated.push({
            kind: "artifact",
            name: reviewBundleFile,
            ok: reviewForTransition.ok,
            details: {
              path: path.join(runRoot, reviewBundleFile),
              decision: reviewForTransition.decision,
              error: reviewForTransition.error ?? null,
            },
          });
        }

        block ??= blockIfFailed(
          reviewForTransition.ok,
          "MISSING_ARTIFACT",
          "review decision incomplete",
          { file: reviewBundleFile },
        );

        if (!block) {
          const changesRequired = reviewForTransition.decision === "CHANGES_REQUIRED";
          evaluated.push({
            kind: "policy",
            name: "review->synthesis requires CHANGES_REQUIRED",
            ok: changesRequired,
            details: { decision: reviewForTransition.decision },
          });
          block ??= blockIfFailed(
            changesRequired,
            "REQUESTED_NEXT_NOT_ALLOWED",
            "review decision must be CHANGES_REQUIRED for synthesis transition",
            { decision: reviewForTransition.decision, requested_next: requested || null },
          );
        }

        if (!block) {
          const limitsObj = isPlainObject(manifest.limits) ? (manifest.limits as Record<string, unknown>) : {};
          const capRaw = limitsObj.max_review_iterations;
          const capNumber = typeof capRaw === "number" ? capRaw : Number(capRaw ?? Number.NaN);
          const capValid = Number.isFinite(capNumber) && capNumber >= 0;
          const cap = capValid ? Math.trunc(capNumber) : 0;
          const count = countReviewToSynthesisTransitions();

          if (!capValid) {
            block = {
              code: "INVALID_STATE",
              message: "manifest.limits.max_review_iterations invalid",
              details: { value: capRaw ?? null },
            };
          } else {
            const withinCap = count < cap;
            evaluated.push({
              kind: "limit",
              name: "review->synthesis count < max_review_iterations",
              ok: withinCap,
              details: { cap, count },
            });
            block ??= blockIfFailed(
              withinCap,
              "REVIEW_CAP_EXCEEDED",
              "review->synthesis transition cap reached",
              { cap, count },
            );
          }
        }
      }

      if (from === "review" && to === "finalize") {
        block ??= blockIfFailed(evalGatePass("E"), "GATE_BLOCKED", "Gate E not pass", { gate: "E" });
        block ??= blockIfFailed(evalGatePass("F"), "GATE_BLOCKED", "Gate F not pass", { gate: "F" });
      }

      const digestInput = {
        schema: "stage_advance.decision.v1",
        from,
        to,
        requested_next: requested || null,
        manifest_revision: Number(manifest.revision ?? 0),
        gates_revision: gatesRevision,
        gates_status: {
          A: (isPlainObject(gates.A) ? (gates.A as Record<string, unknown>).status : null) ?? null,
          B: (isPlainObject(gates.B) ? (gates.B as Record<string, unknown>).status : null) ?? null,
          C: (isPlainObject(gates.C) ? (gates.C as Record<string, unknown>).status : null) ?? null,
          D: (isPlainObject(gates.D) ? (gates.D as Record<string, unknown>).status : null) ?? null,
          E: (isPlainObject(gates.E) ? (gates.E as Record<string, unknown>).status : null) ?? null,
          F: (isPlainObject(gates.F) ? (gates.F as Record<string, unknown>).status : null) ?? null,
        },
        evaluated,
      };
      const inputs_digest = `sha256:${sha256HexLowerUtf8(JSON.stringify(digestInput))}`;

      const decision = {
        allowed: block === null,
        evaluated,
        inputs_digest,
      };

      if (block) {
        return err(block.code, block.message, { ...block.details, from, to: toCandidate || to, decision });
      }

      const ts = nowIso();
      const stage = isPlainObject(manifest.stage) ? (manifest.stage as Record<string, unknown>) : {};
      const history = Array.isArray(stage.history) ? stage.history : [];
      const historyEntry = {
        from,
        to,
        ts,
        reason: args.reason,
        inputs_digest,
        gates_revision: gatesRevision,
      };

      const nextStatus = to === "finalize" ? "completed" : "running";
      const patch = {
        status: nextStatus,
        stage: {
          current: to,
          started_at: ts,
          last_progress_at: ts,
          history: [...history, historyEntry],
        },
      };

      const writeRaw = (await (manifest_write as unknown as ToolWithExecute).execute({
        manifest_path: args.manifest_path,
        patch,
        expected_revision: manifestRevision,
        reason: `stage_advance: ${args.reason}`,
      })) as string;

      const writeObj = parseJsonSafe(writeRaw);
      if (!writeObj.ok) {
        return err("WRITE_FAILED", "failed to persist manifest stage transition", {
          from,
          to,
          write_error: writeObj.value,
        });
      }

      if (!isPlainObject(writeObj.value)) {
        return err("WRITE_FAILED", "manifest_write returned invalid response", {
          from,
          to,
          write_error: writeObj.value,
        });
      }

      const newRevision = Number((writeObj.value as Record<string, unknown>).new_revision ?? Number.NaN);
      if (!Number.isFinite(newRevision)) {
        return err("WRITE_FAILED", "manifest_write missing new_revision", {
          from,
          to,
          write_error: writeObj.value,
        });
      }

      return ok({ from, to, decision, manifest_revision: newRevision });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path or gates_path not found");
      return err("WRITE_FAILED", "stage_advance failed", { message: String(e) });
    }
  },
});
