import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tool } from "@opencode-ai/plugin";

import {
  appendAuditJsonl,
  err,
  errorCode,
  getManifestArtifacts,
  getManifestPaths,
  getStringProp,
  isPlainObject,
  nowIso,
  ok,
  readJson,
  sha256DigestForJson,
  validateManifestV1,
  validatePerspectivesV1,
  validateScopeV1,
} from "./wave_tools_shared";

type PathInspection = {
  absPath: string;
  exists: boolean;
  safe: boolean;
};

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function inspectPath(args: {
  runRoot: string;
  runRootReal: string;
  inputPath: string;
}): Promise<PathInspection> {
  const absPath = path.isAbsolute(args.inputPath)
    ? path.resolve(args.inputPath)
    : path.resolve(args.runRoot, args.inputPath);

  const runRootAbs = path.resolve(args.runRoot);
  if (!isPathInsideRoot(runRootAbs, absPath)) {
    return {
      absPath,
      exists: false,
      safe: false,
    };
  }

  try {
    await fs.access(absPath);
  } catch {
    return {
      absPath,
      exists: false,
      safe: true,
    };
  }

  try {
    const realPath = await fs.realpath(absPath);
    if (!isPathInsideRoot(args.runRootReal, realPath)) {
      return {
        absPath,
        exists: true,
        safe: false,
      };
    }
  } catch {
    return {
      absPath,
      exists: true,
      safe: false,
    };
  }

  return {
    absPath,
    exists: true,
    safe: true,
  };
}

export const gate_a_evaluate = tool({
  description: "Compute deterministic Gate A metrics from scope/perspectives/wave1 plan artifacts",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: {
    manifest_path: string;
    reason: string;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const reason = args.reason.trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: args.manifest_path });
      }
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      let manifestRaw: unknown;
      try {
        manifestRaw = await readJson(manifestPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path missing", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest unreadable", { manifest_path: manifestPath });
        throw e;
      }

      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));

      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "manifest.artifacts.root invalid", { root: runRoot });
      }

      let runRootReal: string;
      try {
        runRootReal = await fs.realpath(runRoot);
      } catch (e) {
        if (errorCode(e) === "ENOENT") {
          return err("NOT_FOUND", "run root missing", { run_root: runRoot });
        }
        throw e;
      }

      const paths = getManifestPaths(manifest);
      const scopePathInspection = await inspectPath({
        runRoot,
        runRootReal,
        inputPath: path.join(runRoot, "operator", "scope.json"),
      });
      const perspectivesPathInspection = await inspectPath({
        runRoot,
        runRootReal,
        inputPath: path.join(runRoot, String(paths.perspectives_file ?? "perspectives.json")),
      });
      const wave1PlanPathInspection = await inspectPath({
        runRoot,
        runRootReal,
        inputPath: path.join(runRoot, String(paths.wave1_dir ?? "wave-1"), "wave1-plan.json"),
      });

      const warnings: string[] = [];
      const warningDetails: Record<string, unknown> = {};
      const addWarning = (code: string, details?: Record<string, unknown>) => {
        if (!warnings.includes(code)) warnings.push(code);
        if (details) warningDetails[code] = details;
      };

      type Perspective = { id: string };
      type PlanEntry = { perspective_id: string; prompt_md: string };

      let scopeValid = false;
      let perspectivesValid = false;
      let wave1PlanValid = false;
      let perspectives: Perspective[] = [];
      let planEntries: PlanEntry[] = [];

      if (!scopePathInspection.safe) {
        addWarning("SCOPE_PATH_TRAVERSAL", {
          scope_path: scopePathInspection.absPath,
        });
      } else if (!scopePathInspection.exists) {
        addWarning("SCOPE_NOT_FOUND", {
          scope_path: scopePathInspection.absPath,
        });
      } else {
        try {
          const scopeRaw = await readJson(scopePathInspection.absPath);
          const scopeErr = validateScopeV1(scopeRaw);
          if (scopeErr) {
            addWarning("SCOPE_SCHEMA_INVALID", {
              scope_path: scopePathInspection.absPath,
              error: scopeErr,
            });
          } else if (String((scopeRaw as Record<string, unknown>).run_id ?? "") !== runId) {
            addWarning("SCOPE_RUN_ID_MISMATCH", {
              scope_path: scopePathInspection.absPath,
              manifest_run_id: runId,
              scope_run_id: String((scopeRaw as Record<string, unknown>).run_id ?? ""),
            });
          } else {
            scopeValid = true;
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            addWarning("SCOPE_INVALID_JSON", {
              scope_path: scopePathInspection.absPath,
            });
          } else {
            throw e;
          }
        }
      }

      if (!perspectivesPathInspection.safe) {
        addWarning("PERSPECTIVES_PATH_TRAVERSAL", {
          perspectives_path: perspectivesPathInspection.absPath,
        });
      } else if (!perspectivesPathInspection.exists) {
        addWarning("PERSPECTIVES_NOT_FOUND", {
          perspectives_path: perspectivesPathInspection.absPath,
        });
      } else {
        try {
          const perspectivesRaw = await readJson(perspectivesPathInspection.absPath);
          const pErr = validatePerspectivesV1(perspectivesRaw);
          if (pErr) {
            addWarning("PERSPECTIVES_SCHEMA_INVALID", {
              perspectives_path: perspectivesPathInspection.absPath,
              error: pErr,
            });
          } else if (String((perspectivesRaw as Record<string, unknown>).run_id ?? "") !== runId) {
            addWarning("PERSPECTIVES_RUN_ID_MISMATCH", {
              perspectives_path: perspectivesPathInspection.absPath,
              manifest_run_id: runId,
              perspectives_run_id: String((perspectivesRaw as Record<string, unknown>).run_id ?? ""),
            });
          } else {
            const raw = Array.isArray((perspectivesRaw as Record<string, unknown>).perspectives)
              ? ((perspectivesRaw as Record<string, unknown>).perspectives as Array<Record<string, unknown>>)
              : [];
            perspectives = raw.map((entry) => ({ id: String(entry.id ?? "").trim() }));
            perspectivesValid = true;
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            addWarning("PERSPECTIVES_INVALID_JSON", {
              perspectives_path: perspectivesPathInspection.absPath,
            });
          } else {
            throw e;
          }
        }
      }

      if (!wave1PlanPathInspection.safe) {
        addWarning("WAVE1_PLAN_PATH_TRAVERSAL", {
          wave1_plan_path: wave1PlanPathInspection.absPath,
        });
      } else if (!wave1PlanPathInspection.exists) {
        addWarning("WAVE1_PLAN_NOT_FOUND", {
          wave1_plan_path: wave1PlanPathInspection.absPath,
        });
      } else {
        try {
          const planRaw = await readJson(wave1PlanPathInspection.absPath);
          if (!isPlainObject(planRaw) || planRaw.schema_version !== "wave1_plan.v1") {
            addWarning("WAVE1_PLAN_SCHEMA_INVALID", {
              wave1_plan_path: wave1PlanPathInspection.absPath,
              reason: "schema_version",
            });
          } else if (String(planRaw.run_id ?? "") !== runId) {
            addWarning("WAVE1_PLAN_RUN_ID_MISMATCH", {
              wave1_plan_path: wave1PlanPathInspection.absPath,
              manifest_run_id: runId,
              wave1_plan_run_id: String(planRaw.run_id ?? ""),
            });
          } else if (!Array.isArray(planRaw.entries)) {
            addWarning("WAVE1_PLAN_SCHEMA_INVALID", {
              wave1_plan_path: wave1PlanPathInspection.absPath,
              reason: "entries",
            });
          } else {
            const parsedEntries: PlanEntry[] = [];
            let hasInvalidEntry = false;
            for (const [index, entry] of planRaw.entries.entries()) {
              if (!isPlainObject(entry)) {
                hasInvalidEntry = true;
                addWarning("WAVE1_PLAN_SCHEMA_INVALID", {
                  wave1_plan_path: wave1PlanPathInspection.absPath,
                  reason: "entry_not_object",
                  index,
                });
                break;
              }

              const perspectiveId = String(entry.perspective_id ?? "").trim();
              const promptMd = String(entry.prompt_md ?? "").trim();
              if (!perspectiveId || !promptMd) {
                hasInvalidEntry = true;
                addWarning("WAVE1_PLAN_SCHEMA_INVALID", {
                  wave1_plan_path: wave1PlanPathInspection.absPath,
                  reason: "entry_missing_fields",
                  index,
                });
                break;
              }

              parsedEntries.push({
                perspective_id: perspectiveId,
                prompt_md: promptMd,
              });
            }

            if (!hasInvalidEntry) {
              planEntries = parsedEntries;
              wave1PlanValid = true;
            }
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            addWarning("WAVE1_PLAN_INVALID_JSON", {
              wave1_plan_path: wave1PlanPathInspection.absPath,
            });
          } else {
            throw e;
          }
        }
      }

      const maxWave1AgentsRaw = Number((manifest.limits as Record<string, unknown>).max_wave1_agents ?? Number.NaN);
      const maxWave1Agents = Number.isFinite(maxWave1AgentsRaw)
        ? Math.max(0, Math.trunc(maxWave1AgentsRaw))
        : 0;

      const perspectivesCount = perspectives.length;
      const planEntriesCount = planEntries.length;

      if (perspectivesValid && perspectivesCount > maxWave1Agents) {
        addWarning("PERSPECTIVE_CAP_EXCEEDED", {
          max_wave1_agents: maxWave1Agents,
          perspectives_count: perspectivesCount,
        });
      }

      let idsMatchInOrder = false;
      if (perspectivesValid && wave1PlanValid) {
        if (planEntriesCount !== perspectivesCount) {
          addWarning("PLAN_ENTRY_COUNT_MISMATCH", {
            perspectives_count: perspectivesCount,
            plan_entries_count: planEntriesCount,
          });
        } else {
          idsMatchInOrder = true;
          for (let i = 0; i < perspectivesCount; i += 1) {
            if (planEntries[i].perspective_id !== perspectives[i].id) {
              idsMatchInOrder = false;
              addWarning("PLAN_PERSPECTIVE_ORDER_MISMATCH", {
                index: i,
                expected: perspectives[i].id,
                actual: planEntries[i].perspective_id,
              });
              break;
            }
          }
        }
      }

      let promptScopeContractOkCount = 0;
      if (wave1PlanValid) {
        for (const [index, entry] of planEntries.entries()) {
          if (entry.prompt_md.includes("## Scope Contract")) {
            promptScopeContractOkCount += 1;
            continue;
          }
          addWarning("PLAN_PROMPT_SCOPE_CONTRACT_MISSING", {
            index,
            perspective_id: entry.perspective_id,
          });
        }
      }

      const promptScopeContractTotal = wave1PlanValid ? planEntriesCount : 0;
      const promptScopeContractRate = promptScopeContractTotal === 0
        ? 0
        : Number((promptScopeContractOkCount / promptScopeContractTotal).toFixed(6));

      const metrics = {
        scope_present: scopePathInspection.exists ? 1 : 0,
        scope_valid: scopeValid ? 1 : 0,
        perspectives_present: perspectivesPathInspection.exists ? 1 : 0,
        perspectives_valid: perspectivesValid ? 1 : 0,
        wave1_plan_present: wave1PlanPathInspection.exists ? 1 : 0,
        wave1_plan_valid: wave1PlanValid ? 1 : 0,
        perspectives_count: perspectivesCount,
        plan_entries_count: planEntriesCount,
        max_wave1_agents: maxWave1Agents,
        ids_match_in_order: idsMatchInOrder ? 1 : 0,
        prompt_scope_contract_ok_count: promptScopeContractOkCount,
        prompt_scope_contract_total: promptScopeContractTotal,
        prompt_scope_contract_rate: promptScopeContractRate,
      };

      const status: "pass" | "fail" = warnings.length === 0 ? "pass" : "fail";
      const checkedAt = nowIso();
      const artifactsOut = [
        toPosixPath(path.relative(runRoot, scopePathInspection.absPath)),
        toPosixPath(path.relative(runRoot, perspectivesPathInspection.absPath)),
        toPosixPath(path.relative(runRoot, wave1PlanPathInspection.absPath)),
      ];
      const notes = status === "pass"
        ? "Gate A passed: scope/perspectives/plan are consistent and wave1 prompts embed scope contract."
        : `Gate A failed: ${warnings.join(", ")}`;

      const update = {
        A: {
          status,
          checked_at: checkedAt,
          metrics,
          artifacts: artifactsOut,
          warnings,
          notes,
        },
      };

      const inputsDigest = sha256DigestForJson({
        schema: "gate_a_evaluate.inputs.v1",
        run_id: runId,
        scope_path: artifactsOut[0],
        perspectives_path: artifactsOut[1],
        wave1_plan_path: artifactsOut[2],
        metrics,
        warnings,
        warning_details: warningDetails,
      });

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: checkedAt,
            kind: "gate_a_evaluate",
            run_id: runId,
            reason,
            status,
            metrics,
            warnings,
            warning_details: warningDetails,
            inputs_digest: inputsDigest,
          },
        });
      } catch {
        // best effort only
      }

      return ok({
        gate_id: "A",
        status,
        metrics,
        update,
        inputs_digest: inputsDigest,
        warnings,
        warning_details: warningDetails,
        scope_path: scopePathInspection.absPath,
        perspectives_path: perspectivesPathInspection.absPath,
        wave1_plan_path: wave1PlanPathInspection.absPath,
        rule:
          "scope.v1 + perspectives.v1 + wave1-plan entries aligned to perspectives order + prompt_md contains ## Scope Contract",
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file missing");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON artifact", { message: String(e) });
      return err("WRITE_FAILED", "gate_a_evaluate failed", { message: String(e) });
    }
  },
});

export const deep_research_gate_a_evaluate = gate_a_evaluate;
