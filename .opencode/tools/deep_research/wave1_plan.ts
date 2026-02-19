import { tool } from "@opencode-ai/plugin";
import * as path from "node:path";

import {
  appendAuditJsonl,
  atomicWriteJson,
  buildWave1PromptMd,
  err,
  errorCode,
  getManifestArtifacts,
  getManifestPaths,
  getStringProp,
  isFiniteNumber,
  nowIso,
  ok,
  readJson,
  renderScopeContractMd,
  sha256DigestForJson,
  validateManifestV1,
  validatePerspectivesV1,
  validateScopeV1,
  isPlainObject,
  type ScopeV1,
} from "./wave_tools_shared";

export const wave1_plan = tool({
  description: "Build deterministic Wave 1 plan artifact from perspectives.v1",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    perspectives_path: tool.schema.string().optional().describe("Absolute path to perspectives.json"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: { manifest_path: string; perspectives_path?: string; reason: string }) {
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
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path not found", { manifest_path: manifestPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "manifest_path contains invalid JSON", { manifest_path: manifestPath });
        throw e;
      }

      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const artifacts = getManifestArtifacts(manifest);
      const runRoot = String((artifacts ? getStringProp(artifacts, "root") : null) ?? path.dirname(manifestPath));
      const runId = String(manifest.run_id ?? "");

      const pathsObj = getManifestPaths(manifest);
      const wave1Dir = String(pathsObj.wave1_dir ?? "wave-1");
      const perspectivesFile = String(pathsObj.perspectives_file ?? "perspectives.json");

      const perspectivesPathInput = args.perspectives_path?.trim() ?? "";
      const perspectivesPath = perspectivesPathInput || path.join(runRoot, perspectivesFile);
      if (!path.isAbsolute(perspectivesPath)) {
        return err("INVALID_ARGS", "perspectives_path must be absolute", { perspectives_path: args.perspectives_path ?? null });
      }

      let perspectivesRaw: unknown;
      try {
        perspectivesRaw = await readJson(perspectivesPath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "perspectives_path not found", { perspectives_path: perspectivesPath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "perspectives_path contains invalid JSON", { perspectives_path: perspectivesPath });
        throw e;
      }

      const pErr = validatePerspectivesV1(perspectivesRaw);
      if (pErr) return pErr;

      const perspectivesDoc = perspectivesRaw as Record<string, unknown>;
      if (String(perspectivesDoc.run_id ?? "") !== runId) {
        return err("INVALID_STATE", "manifest and perspectives run_id mismatch", {
          manifest_run_id: runId,
          perspectives_run_id: String(perspectivesDoc.run_id ?? ""),
        });
      }

      const maxWave1AgentsRaw = (manifest.limits as Record<string, unknown>)?.max_wave1_agents;
      const maxWave1Agents = isFiniteNumber(maxWave1AgentsRaw) ? Math.max(0, Math.floor(maxWave1AgentsRaw)) : 0;

      const rawPerspectives = ((perspectivesDoc.perspectives as Array<Record<string, unknown>>) ?? []);
      if (rawPerspectives.length > maxWave1Agents) {
        return err("WAVE_CAP_EXCEEDED", "too many perspectives for wave1", {
          cap: maxWave1Agents,
          count: rawPerspectives.length,
        });
      }

      const orderedPerspectives = [...rawPerspectives];

      const queryObj = isPlainObject(manifest.query) ? (manifest.query as Record<string, unknown>) : {};
      const queryText = String(queryObj.text ?? "");

      const scopePath = path.join(runRoot, "operator", "scope.json");
      let scopeRaw: unknown;
      try {
        scopeRaw = await readJson(scopePath);
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "scope_path not found", { scope_path: scopePath });
        if (e instanceof SyntaxError) return err("INVALID_JSON", "scope_path contains invalid JSON", { scope_path: scopePath });
        throw e;
      }

      const sErr = validateScopeV1(scopeRaw);
      if (sErr) return sErr;

      const scopeDoc = scopeRaw as ScopeV1;
      if (scopeDoc.run_id !== runId) {
        return err("INVALID_STATE", "manifest and scope run_id mismatch", {
          manifest_run_id: runId,
          scope_run_id: scopeDoc.run_id,
          scope_path: scopePath,
        });
      }

      const scopeContractMd = renderScopeContractMd(scopeDoc);

      const digestPayload = {
        schema: "wave1_plan.inputs.v1",
        run_id: runId,
        query_text: queryText,
        scope_contract_md: scopeContractMd,
        max_wave1_agents: maxWave1Agents,
        wave1_dir: wave1Dir,
        perspectives: orderedPerspectives.map((perspective) => {
          const contract = (perspective.prompt_contract ?? {}) as Record<string, unknown>;
          return {
            id: String(perspective.id ?? ""),
            agent_type: String(perspective.agent_type ?? ""),
            max_words: Number(contract.max_words ?? 0),
            max_sources: Number(contract.max_sources ?? 0),
            must_include_sections: Array.isArray(contract.must_include_sections)
              ? contract.must_include_sections.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)
              : [],
          };
        }),
      };
      const inputsDigest = sha256DigestForJson(digestPayload);

      const entries = orderedPerspectives.map((perspective) => {
        const perspectiveId = String(perspective.id ?? "");
        const contract = (perspective.prompt_contract ?? {}) as Record<string, unknown>;
        const maxWords = Number(contract.max_words ?? 0);
        const maxSources = Number(contract.max_sources ?? 0);
        const mustIncludeSections = Array.isArray(contract.must_include_sections)
          ? contract.must_include_sections.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)
          : [];

        return {
          perspective_id: perspectiveId,
          agent_type: String(perspective.agent_type ?? ""),
          output_md: `${wave1Dir}/${perspectiveId}.md`,
          prompt_md: buildWave1PromptMd({
            queryText,
            perspectiveId,
            title: String(perspective.title ?? ""),
            track: String(perspective.track ?? ""),
            agentType: String(perspective.agent_type ?? ""),
            maxWords,
            maxSources,
            mustIncludeSections,
            scopeContractMd,
          }),
        };
      });

      const generatedAt = nowIso();
      const plan = {
        schema_version: "wave1_plan.v1",
        run_id: runId,
        generated_at: generatedAt,
        inputs_digest: inputsDigest,
        entries,
      };

      const planPath = path.join(runRoot, wave1Dir, "wave1-plan.json");
      await atomicWriteJson(planPath, plan);

      const auditEvent = {
        ts: generatedAt,
        kind: "wave1_plan",
        run_id: runId,
        reason,
        plan_path: planPath,
        planned: entries.length,
        inputs_digest: inputsDigest,
      };

      try {
        await appendAuditJsonl({ runRoot, event: auditEvent });
      } catch {
        // best effort only
      }

      return ok({
        plan_path: planPath,
        inputs_digest: inputsDigest,
        planned: entries.length,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path or perspectives_path not found");
      return err("WRITE_FAILED", "wave1 plan failed", { message: String(e) });
    }
  },
});
