import { tool, type ToolContext } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "../../plugins/lib/paths";
import { manifest_write } from "./manifest_write";
import { run_init } from "./run_init";
import {
  err,
  isPlainObject,
  ok,
  type ToolWithExecute,
} from "./wave_tools_shared";
import { copyDirContents, parseJsonSafe, statPath } from "./wave_tools_io";

export const dry_run_seed = tool({
  description: "Seed deterministic dry-run run root from fixture artifacts",
  args: {
    fixture_dir: tool.schema.string().describe("Absolute path to fixtures/dry-run/<case-id>"),
    run_id: tool.schema.string().describe("Deterministic run id"),
    reason: tool.schema.string().describe("Audit reason"),
    root_override: tool.schema.string().optional().describe("Absolute root override for run_init"),
  },
  async execute(
    args: {
      fixture_dir: string;
      run_id: string;
      reason: string;
      root_override?: string;
    },
    context: ToolContext,
  ) {
    try {
      const fixtureDirInput = args.fixture_dir.trim();
      const runId = args.run_id.trim();
      const reason = args.reason.trim();
      const rootOverrideInput = (args.root_override ?? "").trim();

      if (!fixtureDirInput) return err("INVALID_ARGS", "fixture_dir must be non-empty");
      if (!runId) return err("INVALID_ARGS", "run_id must be non-empty");
      if (!reason) return err("INVALID_ARGS", "reason must be non-empty");

      const fixtureDir = path.resolve(fixtureDirInput);
      if (!path.isAbsolute(fixtureDir)) {
        return err("INVALID_ARGS", "fixture_dir must be absolute", { fixture_dir: args.fixture_dir });
      }

      const fixtureStat = await statPath(fixtureDir);
      if (!fixtureStat?.isDirectory()) {
        return err("NOT_FOUND", "fixture_dir not found or not a directory", { fixture_dir: fixtureDir });
      }

      const manifestSeedPath = path.join(fixtureDir, "manifest.json");
      const wave1SeedPath = path.join(fixtureDir, "wave-1");

      const hasManifestSeed = Boolean((await statPath(manifestSeedPath))?.isFile());
      const hasWave1Seed = Boolean((await statPath(wave1SeedPath))?.isDirectory());

      if (!hasManifestSeed && !hasWave1Seed) {
        return err("INVALID_FIXTURE", "fixture must include manifest.json or wave-1/", {
          fixture_dir: fixtureDir,
          required_any_of: ["manifest.json", "wave-1/"],
        });
      }

      const caseId = path.basename(fixtureDir);
      const rootOverride = rootOverrideInput || path.join(path.dirname(fixtureDir), ".tmp-runs");
      if (!path.isAbsolute(rootOverride)) {
        return err("INVALID_ARGS", "root_override must be absolute", { root_override: args.root_override ?? null });
      }

      const initRaw = (await (run_init as unknown as ToolWithExecute).execute(
        {
          query: `dry-run fixture seed: ${caseId}`,
          mode: "standard",
          sensitivity: "no_web",
          run_id: runId,
          root_override: rootOverride,
        },
        context,
      )) as string;

      const initParsed = parseJsonSafe(initRaw);
      if (!initParsed.ok) {
        return err("UPSTREAM_INVALID_JSON", "run_init returned non-JSON", { raw: initParsed.value });
      }
      if (!isPlainObject(initParsed.value) || initParsed.value.ok !== true) {
        return JSON.stringify(initParsed.value, null, 2);
      }
      const initValue = initParsed.value;
      if (initValue.created === false) {
        return err("ALREADY_EXISTS", "run already exists; dry-run seed requires a fresh run_id", {
          run_id: runId,
          root: initValue.root ?? null,
        });
      }

      const runRoot = String(initValue.root ?? "");
      if (!runRoot || !path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "run_init returned invalid run root", {
          root: initValue.root ?? null,
        });
      }

      const copiedRoots: string[] = [];
      const copiedEntries: string[] = [];

      for (const artifactName of ["wave-1", "wave-2", "citations"] as const) {
        const src = path.join(fixtureDir, artifactName);
        const dst = path.join(runRoot, artifactName);
        const st = await statPath(src);
        if (!st) continue;

        copiedRoots.push(artifactName);
        if (st.isDirectory()) {
          await copyDirContents(src, dst, copiedEntries, artifactName);
          continue;
        }
        if (st.isFile()) {
          await ensureDir(path.dirname(dst));
          await fs.promises.copyFile(src, dst);
          copiedEntries.push(artifactName);
          continue;
        }

        return err("INVALID_FIXTURE", "fixture contains unsupported artifact type", {
          artifact: artifactName,
          path: src,
        });
      }

      const patchRaw = (await (manifest_write as unknown as ToolWithExecute).execute(
        {
          manifest_path: String(initValue.manifest_path),
          reason: `dry_run_seed: ${reason}`,
          patch: {
            query: {
              sensitivity: "no_web",
              constraints: {
                dry_run: {
                  fixture_dir: fixtureDir,
                  case_id: caseId,
                },
              },
            },
          },
        },
        context,
      )) as string;

      const patchParsed = parseJsonSafe(patchRaw);
      if (!patchParsed.ok) {
        return err("UPSTREAM_INVALID_JSON", "manifest_write returned non-JSON", { raw: patchParsed.value });
      }
      if (!isPlainObject(patchParsed.value) || patchParsed.value.ok !== true) return JSON.stringify(patchParsed.value, null, 2);

      copiedEntries.sort();
      copiedRoots.sort();

      return ok({
        run_id: runId,
        root: runRoot,
        manifest_path: String(initValue.manifest_path),
        gates_path: String(initValue.gates_path),
        root_override: rootOverride,
        copied: {
          roots: copiedRoots,
          entries: copiedEntries,
        },
        dry_run: {
          fixture_dir: fixtureDir,
          case_id: caseId,
        },
        manifest_revision: Number((patchParsed.value as Record<string, unknown>).new_revision ?? 0),
      });
    } catch (e) {
      return err("WRITE_FAILED", "dry_run_seed failed", { message: String(e) });
    }
  },
});
