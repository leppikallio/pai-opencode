import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "../../plugins/lib/paths";
import { resolveDeepResearchFlagsV1 } from "./flags_v1";
import { validateGatesV1, validateManifestV1 } from "./schema_v1";
import { err, errorCode, isPlainObject, ok, readJson } from "./utils";
import { copyDirContents, parseJsonSafe, statPath } from "./wave_tools_io";

function isPathWithin(baseDir: string, targetPath: string): boolean {
  const rel = path.relative(baseDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function runIdTraversalError(runId: string): string | null {
  if (path.isAbsolute(runId)) return "run_id must not be an absolute path";
  if (runId === "." || runId === "..") return "run_id must not be '.' or '..'";
  if (runId.includes("/") || runId.includes("\\")) return "run_id must not contain path separators";
  return null;
}

async function cleanupSeedRoot(root: string): Promise<void> {
  await fs.promises.rm(root, { recursive: true, force: true });
}

export const fixture_run_seed = tool({
  description: "Seed deterministic run root from run snapshot fixture",
  args: {
    fixture_dir: tool.schema.string().describe("Absolute path to run-root-shaped fixture directory"),
    run_id: tool.schema.string().describe("Deterministic run id"),
    reason: tool.schema.string().describe("Audit reason"),
    root_override: tool.schema.string().optional().describe("Absolute base runs root override"),
  },
  async execute(args: { fixture_dir: string; run_id: string; reason: string; root_override?: string }) {
    let rollbackRoot: string | null = null;
    let rootCreated = false;

    try {
      const fixtureDirInput = args.fixture_dir.trim();
      const runId = args.run_id.trim();
      const reason = args.reason.trim();
      const rootOverrideInput = (args.root_override ?? "").trim();

      if (!fixtureDirInput || !path.isAbsolute(fixtureDirInput)) {
        return err("INVALID_ARGS", "fixture_dir must be absolute", { fixture_dir: args.fixture_dir });
      }
      if (!runId) return err("INVALID_ARGS", "run_id must be non-empty");
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");
      const traversalError = runIdTraversalError(runId);
      if (traversalError) {
        return err("PATH_TRAVERSAL", traversalError, { run_id: runId });
      }
      if (rootOverrideInput && !path.isAbsolute(rootOverrideInput)) {
        return err("INVALID_ARGS", "root_override must be absolute", { root_override: args.root_override });
      }

      const fixtureDir = path.resolve(fixtureDirInput);
      const fixtureStat = await statPath(fixtureDir);
      if (!fixtureStat?.isDirectory()) {
        return err("MISSING_ARTIFACT", "fixture_dir not found or not a directory", { fixture_dir: fixtureDir });
      }

      const fixtureManifestPath = path.join(fixtureDir, "manifest.json");
      const fixtureGatesPath = path.join(fixtureDir, "gates.json");
      const missing: string[] = [];
      if (!(await statPath(fixtureManifestPath))?.isFile()) missing.push("manifest.json");
      if (!(await statPath(fixtureGatesPath))?.isFile()) missing.push("gates.json");
      if (missing.length > 0) {
        return err("MISSING_ARTIFACT", "fixture missing required artifacts", {
          fixture_dir: fixtureDir,
          missing,
        });
      }

      const runsRoot = path.resolve(rootOverrideInput || resolveDeepResearchFlagsV1().runsRoot);
      const root = path.resolve(runsRoot, runId);
      rollbackRoot = root;
      if (!isPathWithin(runsRoot, root)) {
        return err("PATH_TRAVERSAL", "run_id resolves outside runs root", {
          run_id: runId,
          runs_root: runsRoot,
          root,
        });
      }
      if (isPathWithin(fixtureDir, root)) {
        return err("INVALID_ARGS", "run root must not be inside fixture_dir", {
          fixture_dir: fixtureDir,
          root,
        });
      }

      const existingRoot = await statPath(root);
      if (existingRoot) {
        return err("INVALID_ARGS", "run root already exists", { run_id: runId, root });
      }

      const failWithRollback = async (code: string, message: string, details: Record<string, unknown> = {}) => {
        if (rootCreated) {
          try {
            await cleanupSeedRoot(root);
          } catch {
            // Best-effort rollback.
          }
          rootCreated = false;
        }
        return err(code, message, details);
      };

      await ensureDir(runsRoot);
      try {
        await fs.promises.mkdir(root);
        rootCreated = true;
      } catch (e) {
        if (errorCode(e) === "EEXIST") {
          return err("INVALID_ARGS", "run root already exists", { run_id: runId, root });
        }
        throw e;
      }
      await copyDirContents(fixtureDir, root, [], "");

      const logsDir = path.join(root, "logs");
      const auditPath = path.join(logsDir, "audit.jsonl");
      await ensureDir(logsDir);
      const auditStat = await statPath(auditPath);
      if (!auditStat) {
        await fs.promises.writeFile(auditPath, "", "utf8");
      } else if (!auditStat.isFile()) {
        return await failWithRollback("MISSING_ARTIFACT", "logs/audit.jsonl must be a file", { path: auditPath });
      }

      const manifestPath = path.join(root, "manifest.json");
      const gatesPath = path.join(root, "gates.json");

      let manifestRaw: unknown;
      try {
        manifestRaw = await readJson(manifestPath);
      } catch (e) {
        if (e instanceof SyntaxError) {
          return await failWithRollback("INVALID_JSON", "manifest.json contains invalid JSON", {
            path: manifestPath,
            message: String(e),
          });
        }
        return await failWithRollback("MISSING_ARTIFACT", "manifest.json missing after seed", {
          path: manifestPath,
          message: String(e),
        });
      }

      if (!isPlainObject(manifestRaw)) {
        return await failWithRollback("INVALID_JSON", "manifest.json schema validation failed", {
          path: manifestPath,
          validation: { code: "SCHEMA_VALIDATION_FAILED", message: "schema validation failed", details: { path: "$" } },
        });
      }

      const manifestPatched: Record<string, unknown> = {
        ...manifestRaw,
        run_id: runId,
        artifacts: {
          ...(isPlainObject(manifestRaw.artifacts) ? manifestRaw.artifacts : {}),
          root,
        },
      };

      const manifestValidation = validateManifestV1(manifestPatched);
      if (manifestValidation) {
        return await failWithRollback("INVALID_JSON", "manifest.json schema validation failed", {
          path: manifestPath,
          validation: parseValidationError(manifestValidation),
        });
      }

      await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifestPatched, null, 2)}\n`, "utf8");

      let gatesRaw: unknown;
      try {
        gatesRaw = await readJson(gatesPath);
      } catch (e) {
        if (e instanceof SyntaxError) {
          return await failWithRollback("INVALID_JSON", "gates.json contains invalid JSON", {
            path: gatesPath,
            message: String(e),
          });
        }
        return await failWithRollback("MISSING_ARTIFACT", "gates.json missing after seed", {
          path: gatesPath,
          message: String(e),
        });
      }

      if (!isPlainObject(gatesRaw)) {
        return await failWithRollback("INVALID_JSON", "gates.json schema validation failed", {
          path: gatesPath,
          validation: { code: "SCHEMA_VALIDATION_FAILED", message: "schema validation failed", details: { path: "$" } },
        });
      }

      const gatesPatched: Record<string, unknown> = {
        ...gatesRaw,
        run_id: runId,
      };

      const gatesValidation = validateGatesV1(gatesPatched);
      if (gatesValidation) {
        return await failWithRollback("INVALID_JSON", "gates.json schema validation failed", {
          path: gatesPath,
          validation: parseValidationError(gatesValidation),
        });
      }

      await fs.promises.writeFile(gatesPath, `${JSON.stringify(gatesPatched, null, 2)}\n`, "utf8");

      return ok({
        run_id: runId,
        root,
        manifest_path: manifestPath,
        gates_path: gatesPath,
      });
    } catch (e) {
      if (rootCreated && rollbackRoot) {
        try {
          await cleanupSeedRoot(rollbackRoot);
        } catch {
          // Best-effort rollback.
        }
      }
      return err("WRITE_FAILED", "fixture_run_seed failed", { message: String(e) });
    }
  },
});

function parseValidationError(rawValidation: string): Record<string, unknown> {
  const parsed = parseJsonSafe(rawValidation);
  if (!parsed.ok || !isPlainObject(parsed.value)) {
    return { raw: rawValidation };
  }

  const envelope = parsed.value as Record<string, unknown>;
  const errorValue = isPlainObject(envelope.error) ? (envelope.error as Record<string, unknown>) : null;

  return {
    code: typeof errorValue?.code === "string" ? errorValue.code : "SCHEMA_VALIDATION_FAILED",
    message: typeof errorValue?.message === "string" ? errorValue.message : "schema validation failed",
    details: isPlainObject(errorValue?.details) ? errorValue.details : {},
  };
}

export const deep_research_fixture_run_seed = fixture_run_seed;
