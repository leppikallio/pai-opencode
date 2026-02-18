import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "../../plugins/lib/paths";

import { appendAuditJsonl, toPosixPath } from "./citations_lib";
import { resolveRunRootFromManifest } from "./deep_research_shared_lib";
import { validateManifestV1 } from "./schema_v1";
import {
  err,
  errorCode,
  isInteger,
  isPlainObject,
  nowIso,
  ok,
  readJson,
} from "./utils";

const TICK_LEDGER_SCHEMA_VERSION = "tick_ledger.v1";

function isManifestRelativePathSafe(value: string): boolean {
  if (!value || value.startsWith(path.sep) || value.includes("/../") || value.includes("\\..\\")) {
    return false;
  }
  const normalized = path.normalize(value);
  return normalized !== ".."
    && !normalized.startsWith(`..${path.sep}`)
    && !normalized.split(path.sep).some((segment: string) => segment === "..");
}

async function safeResolveManifestPath(runRoot: string, rel: string, field: string): Promise<string> {
  const relTrimmed = String(rel ?? "").trim() || "logs";
  if (!isManifestRelativePathSafe(relTrimmed)) {
    throw new Error(`${field} must be a relative path without traversal`);
  }

  const runRootAbs = path.resolve(runRoot);
  const candidate = path.resolve(runRootAbs, relTrimmed);
  const relFromRoot = path.relative(runRootAbs, candidate);
  if (relFromRoot === "" || relFromRoot === ".") {
    return path.join(runRootAbs, path.basename(candidate));
  }
  if (relFromRoot.startsWith(`..${path.sep}`) || relFromRoot === "..") {
    throw new Error(`${field} escapes runRoot`);
  }

  return candidate;
}

function normalizeLedgerEntry(value: unknown):
  | { ok: true; entry: Record<string, unknown> }
  | { ok: false; code: string; message: string; details: Record<string, unknown> } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: "INVALID_ARGS",
      message: "entry must be object",
      details: {},
    };
  }

  const entry = value as Record<string, unknown>;
  const tickIndex = Number(entry.tick_index ?? Number.NaN);
  if (!isInteger(tickIndex) || tickIndex <= 0) {
    return {
      ok: false,
      code: "INVALID_ARGS",
      message: "entry.tick_index must be positive integer",
      details: { tick_index: entry.tick_index ?? null },
    };
  }

  const stageBefore = String(entry.stage_before ?? "").trim();
  const stageAfter = String(entry.stage_after ?? stageBefore).trim();
  const statusBefore = String(entry.status_before ?? "").trim();
  const statusAfter = String(entry.status_after ?? statusBefore).trim();
  if (!stageBefore || !stageAfter || !statusBefore || !statusAfter) {
    return {
      ok: false,
      code: "INVALID_ARGS",
      message: "entry must include stage/status before and after",
      details: {
        stage_before: entry.stage_before ?? null,
        stage_after: entry.stage_after ?? null,
        status_before: entry.status_before ?? null,
        status_after: entry.status_after ?? null,
      },
    };
  }

  const result = isPlainObject(entry.result) ? (entry.result as Record<string, unknown>) : null;
  if (!result || typeof result.ok !== "boolean") {
    return {
      ok: false,
      code: "INVALID_ARGS",
      message: "entry.result.ok must be boolean",
      details: { result: entry.result ?? null },
    };
  }

  const normalized: Record<string, unknown> = {
    schema_version: TICK_LEDGER_SCHEMA_VERSION,
    ts: typeof entry.ts === "string" && entry.ts.trim() ? entry.ts.trim() : nowIso(),
    tick_index: tickIndex,
    phase: typeof entry.phase === "string" && entry.phase.trim() ? entry.phase.trim() : "finish",
    stage_before: stageBefore,
    stage_after: stageAfter,
    status_before: statusBefore,
    status_after: statusAfter,
    result,
    inputs_digest: typeof entry.inputs_digest === "string" ? entry.inputs_digest : null,
    artifacts: isPlainObject(entry.artifacts) ? entry.artifacts : {},
  };

  return { ok: true, entry: normalized };
}

export const tick_ledger_append = tool({
  description: "Append tick ledger entry to logs/ticks.jsonl",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    entry: tool.schema.record(tool.schema.string(), tool.schema.unknown()).describe("Tick ledger entry object"),
    reason: tool.schema.string().describe("Audit reason"),
  },
  async execute(args: unknown, context: unknown) {
    try {
      const payload = (() => {
        if (isPlainObject(args) && typeof args.manifest_path === "string") {
          return args as { manifest_path: string; entry: Record<string, unknown>; reason: string };
        }
        if (isPlainObject(context) && typeof context.manifest_path === "string") {
          return context as { manifest_path: string; entry: Record<string, unknown>; reason: string };
        }
        return null;
      })();

      if (!payload) {
        return err("INVALID_ARGS", "manifest_path payload missing", {
          args_keys: isPlainObject(args) ? Object.keys(args) : [],
          context_keys: isPlainObject(context) ? Object.keys(context) : [],
        });
      }

      const manifestPath = String(payload.manifest_path ?? "").trim();
      const reason = String(payload.reason ?? "").trim();
      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) return err("INVALID_ARGS", "manifest_path must be absolute", { manifest_path: payload.manifest_path });
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const normalized = normalizeLedgerEntry(payload.entry);
      if (!normalized.ok) return err(normalized.code, normalized.message, normalized.details);

      const manifestRaw = await readJson(manifestPath);
      const mErr = validateManifestV1(manifestRaw);
      if (mErr) return mErr;

      const manifest = manifestRaw as Record<string, unknown>;
      const runId = String(manifest.run_id ?? "");
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);

      const artifacts = isPlainObject(manifest.artifacts) ? (manifest.artifacts as Record<string, unknown>) : {};
      const pathsObj = isPlainObject(artifacts.paths) ? (artifacts.paths as Record<string, unknown>) : {};
      const logsRel = String(pathsObj.logs_dir ?? "logs").trim() || "logs";
      const logsDirAbs = await safeResolveManifestPath(runRoot, logsRel, "manifest.artifacts.paths.logs_dir");
      const ledgerPath = path.join(logsDirAbs, "ticks.jsonl");

      await ensureDir(path.dirname(ledgerPath));

      const entry: Record<string, unknown> = {
        ...normalized.entry,
        run_id: runId,
      };

      await fs.promises.appendFile(ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");

      try {
        await appendAuditJsonl({
          runRoot,
          event: {
            ts: nowIso(),
            kind: "tick_ledger_append",
            run_id: runId,
            reason,
            tick_index: entry["tick_index"] ?? null,
            phase: entry["phase"] ?? null,
            ledger_path: toPosixPath(path.relative(runRoot, ledgerPath)),
          },
        });
      } catch {
        // best effort
      }

      return ok({
        ledger_path: ledgerPath,
        tick_index: entry["tick_index"] ?? null,
        phase: entry["phase"] ?? null,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "manifest_path not found");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid manifest JSON", { message: String(e) });
      return err("WRITE_FAILED", "tick_ledger_append failed", { message: String(e) });
    }
  },
});

export const deep_research_tick_ledger_append = tick_ledger_append;
