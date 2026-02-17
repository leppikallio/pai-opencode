import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { resolveRunRootFromManifest } from "./deep_research_shared_lib";
import { validateManifestV1, validatePerspectivesV1 } from "./schema_v1";
import type { ToolWithExecute } from "./types";
import {
  atomicWriteText,
  err,
  errorCode,
  isPlainObject,
  ok,
  readJson,
  resolveRunPath,
} from "./utils";
import { parseJsonSafe } from "./wave_tools_io";
import { wave_output_validate } from "./wave_output_validate";

type WaveOutputIngestItem = {
  perspective_id: string;
  markdown: string;
  agent_type?: string;
  prompt_md?: string;
};

type StagedWaveWrite = {
  perspective_id: string;
  markdown_path: string;
  staged_path: string;
};

function isPathWithin(baseDir: string, targetPath: string): boolean {
  const rel = path.relative(baseDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function waveDirInvariantError(waveDirPath: string): string | null {
  const trimmed = waveDirPath.trim();
  if (!trimmed) return "wave directory path must be non-empty";
  if (trimmed === "." || trimmed === "..") {
    return "wave directory path must not be '.' or '..'";
  }

  const segments = trimmed.split(/[\\/]+/).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return "wave directory path must contain at least one segment";
  }
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes(".."))) {
    return "wave directory path segments must not contain '..'";
  }

  return null;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (e) {
    if (errorCode(e) === "ENOENT") return false;
    throw e;
  }
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch (e) {
    if (errorCode(e) !== "ENOENT") throw e;
  }
}

async function cleanupPaths(filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    try {
      await removeIfExists(filePath);
    } catch {
      // Best-effort cleanup during rollback/failure handling.
    }
  }
}

async function safeRealpath(filePath: string): Promise<string | null> {
  try {
    return await fs.realpath(filePath);
  } catch (e) {
    if (errorCode(e) === "ENOENT") return null;
    throw e;
  }
}

function parseOutputItem(entry: unknown): WaveOutputIngestItem | null {
  if (!isPlainObject(entry)) return null;

  const perspectiveId = String(entry.perspective_id ?? "").trim();
  const markdown = typeof entry.markdown === "string" ? entry.markdown : "";
  const agentType = typeof entry.agent_type === "string" ? entry.agent_type : undefined;
  const promptMd = typeof entry.prompt_md === "string" ? entry.prompt_md : undefined;

  return {
    perspective_id: perspectiveId,
    markdown,
    agent_type: agentType,
    prompt_md: promptMd,
  };
}

export const wave_output_ingest = tool({
  description: "Write and validate wave markdown outputs under run root",
  args: {
    manifest_path: tool.schema.string().describe("Absolute path to manifest.json"),
    perspectives_path: tool.schema.string().describe("Absolute path to perspectives.json"),
    wave: tool.schema.enum(["wave1", "wave2"]).describe("Wave target directory"),
    outputs: tool.schema.array(tool.schema.record(tool.schema.string(), tool.schema.unknown()))
      .describe("Wave output records: { perspective_id, markdown, agent_type?, prompt_md? }"),
  },
  async execute(args: {
    manifest_path: string;
    perspectives_path: string;
    wave: "wave1" | "wave2";
    outputs: Array<Record<string, unknown>>;
  }) {
    try {
      const manifestPath = args.manifest_path.trim();
      const perspectivesPath = args.perspectives_path.trim();
      const wave = args.wave;

      if (!manifestPath) return err("INVALID_ARGS", "manifest_path must be non-empty");
      if (!path.isAbsolute(manifestPath)) {
        return err("INVALID_ARGS", "manifest_path must be absolute", {
          manifest_path: args.manifest_path,
        });
      }

      if (!perspectivesPath) return err("INVALID_ARGS", "perspectives_path must be non-empty");
      if (!path.isAbsolute(perspectivesPath)) {
        return err("INVALID_ARGS", "perspectives_path must be absolute", {
          perspectives_path: args.perspectives_path,
        });
      }

      if (!Array.isArray(args.outputs)) {
        return err("INVALID_ARGS", "outputs must be an array", { outputs: args.outputs ?? null });
      }
      if (args.outputs.length === 0) {
        return err("INVALID_ARGS", "outputs must include at least one record");
      }

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

      const manifest = manifestRaw as Record<string, unknown>;
      const perspectivesDoc = perspectivesRaw as Record<string, unknown>;
      const runRoot = resolveRunRootFromManifest(manifestPath, manifest);

      if (!path.isAbsolute(runRoot)) {
        return err("INVALID_STATE", "run root resolved to non-absolute path", { run_root: runRoot });
      }

      if (String(manifest.run_id ?? "") !== String(perspectivesDoc.run_id ?? "")) {
        return err("INVALID_STATE", "manifest and perspectives run_id mismatch", {
          manifest_run_id: String(manifest.run_id ?? ""),
          perspectives_run_id: String(perspectivesDoc.run_id ?? ""),
        });
      }

      let runRootReal: string;
      try {
        runRootReal = await fs.realpath(runRoot);
      } catch (e) {
        if (errorCode(e) === "ENOENT") {
          return err("NOT_FOUND", "run root not found", {
            run_root: runRoot,
          });
        }
        throw e;
      }

      const artifacts = isPlainObject(manifest.artifacts) ? (manifest.artifacts as Record<string, unknown>) : {};
      const artifactPaths = isPlainObject(artifacts.paths) ? (artifacts.paths as Record<string, unknown>) : {};
      const waveRel = wave === "wave1"
        ? String(artifactPaths.wave1_dir ?? "wave-1")
        : String(artifactPaths.wave2_dir ?? "wave-2");

      const invariantError = waveDirInvariantError(waveRel);
      if (invariantError) {
        return err("INVALID_WAVE_DIR", invariantError, {
          wave,
          wave_dir: waveRel,
        });
      }

      const waveDir = resolveRunPath(runRoot, waveRel);

      if (!path.isAbsolute(waveDir)) {
        return err("INVALID_STATE", "wave directory resolved to non-absolute path", {
          wave,
          wave_dir: waveDir,
        });
      }
      if (!isPathWithin(runRoot, waveDir)) {
        return err("PATH_TRAVERSAL", "wave directory escapes run root", {
          wave,
          wave_dir: waveDir,
          run_root: runRoot,
        });
      }

      await fs.mkdir(waveDir, { recursive: true });
      const waveDirStat = await fs.lstat(waveDir);
      if (waveDirStat.isSymbolicLink()) {
        return err("WAVE_DIR_SYMLINK", "wave directory must not be a symlink", {
          wave,
          wave_dir: waveDir,
        });
      }

      const waveDirReal = await fs.realpath(waveDir);
      if (!isPathWithin(runRootReal, waveDirReal)) {
        return err("PATH_TRAVERSAL", "wave directory realpath escapes run root", {
          wave,
          wave_dir: waveDir,
          wave_dir_real: waveDirReal,
          run_root: runRoot,
          run_root_real: runRootReal,
        });
      }

      const perspectiveIds = new Set(
        Array.isArray(perspectivesDoc.perspectives)
          ? perspectivesDoc.perspectives
            .map((entry) => String((entry as Record<string, unknown>).id ?? "").trim())
            .filter((entry) => entry.length > 0)
          : [],
      );

      const seen = new Set<string>();
      const staged: StagedWaveWrite[] = [];
      const txnTag = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;

      for (let i = 0; i < args.outputs.length; i += 1) {
        const item = parseOutputItem(args.outputs[i]);
        if (!item) {
          return err("INVALID_ARGS", "outputs entries must be objects", { index: i });
        }

        const perspectiveId = item.perspective_id;
        if (!perspectiveId) {
          return err("INVALID_ARGS", "output perspective_id must be non-empty", { index: i });
        }
        if (!item.markdown.trim()) {
          return err("INVALID_ARGS", "output markdown must be non-empty", {
            index: i,
            perspective_id: perspectiveId,
          });
        }
        if (perspectiveId.includes("/") || perspectiveId.includes("\\")) {
          return err("PATH_TRAVERSAL", "perspective_id must not contain path separators", {
            index: i,
            perspective_id: perspectiveId,
          });
        }
        if (seen.has(perspectiveId)) {
          return err("DUPLICATE_PERSPECTIVE_ID", "duplicate perspective_id in outputs", {
            perspective_id: perspectiveId,
          });
        }
        seen.add(perspectiveId);

        if (!perspectiveIds.has(perspectiveId)) {
          return err("PERSPECTIVE_NOT_FOUND", "perspective_id not found", {
            perspective_id: perspectiveId,
          });
        }

        const markdownPath = path.resolve(waveDir, `${perspectiveId}.md`);
        if (!isPathWithin(runRoot, markdownPath) || !isPathWithin(waveDir, markdownPath)) {
          return err("PATH_TRAVERSAL", "resolved markdown path escapes allowed directories", {
            perspective_id: perspectiveId,
            markdown_path: markdownPath,
            wave_dir: waveDir,
            run_root: runRoot,
          });
        }

        const existingStat = await fs.lstat(markdownPath).catch((e) => {
          if (errorCode(e) === "ENOENT") return null;
          throw e;
        });
        if (existingStat?.isSymbolicLink()) {
          return err("PATH_TRAVERSAL", "markdown output path must not be a symlink", {
            perspective_id: perspectiveId,
            markdown_path: markdownPath,
          });
        }

        const markdownReal = await safeRealpath(markdownPath);
        if (markdownReal !== null) {
          if (!isPathWithin(runRootReal, markdownReal) || !isPathWithin(waveDirReal, markdownReal)) {
            return err("PATH_TRAVERSAL", "markdown output realpath escapes allowed directories", {
              perspective_id: perspectiveId,
              markdown_path: markdownPath,
              markdown_realpath: markdownReal,
              wave_dir_real: waveDirReal,
              run_root_real: runRootReal,
            });
          }
        } else {
          const parentReal = await fs.realpath(path.dirname(markdownPath));
          if (!isPathWithin(runRootReal, parentReal) || !isPathWithin(waveDirReal, parentReal)) {
            return err("PATH_TRAVERSAL", "markdown output parent escapes allowed directories", {
              perspective_id: perspectiveId,
              markdown_path: markdownPath,
              markdown_parent_realpath: parentReal,
              wave_dir_real: waveDirReal,
              run_root_real: runRootReal,
            });
          }
        }

        const stagedPath = path.join(waveDir, `.${perspectiveId}.txn.${txnTag}.${i}.md`);
        await atomicWriteText(stagedPath, item.markdown);

        staged.push({
          perspective_id: perspectiveId,
          markdown_path: markdownPath,
          staged_path: stagedPath,
        });

        const validateRaw = (await (wave_output_validate as unknown as ToolWithExecute).execute({
          perspectives_path: perspectivesPath,
          perspective_id: perspectiveId,
          markdown_path: stagedPath,
        })) as string;
        const parsed = parseJsonSafe(validateRaw);

        if (!parsed.ok || !isPlainObject(parsed.value)) {
          await cleanupPaths(staged.map((entry) => entry.staged_path));
          return err("WRITE_FAILED", "wave_output_validate returned invalid JSON", {
            perspective_id: perspectiveId,
            raw: parsed.ok ? JSON.stringify(parsed.value) : parsed.value,
          });
        }

        const validation = parsed.value as Record<string, unknown>;
        if (validation.ok !== true) {
          const validationError = isPlainObject(validation.error)
            ? (validation.error as Record<string, unknown>)
            : {};
          const code = String(validationError.code ?? "VALIDATION_FAILED");
          const message = String(validationError.message ?? "wave output validation failed");
          const details = isPlainObject(validationError.details)
            ? (validationError.details as Record<string, unknown>)
            : {};
          await cleanupPaths(staged.map((entry) => entry.staged_path));
          return err(code, message, {
            perspective_id: perspectiveId,
            markdown_path: markdownPath,
            ...details,
          });
        }
      }

      const backups: Array<{ markdown_path: string; backup_path: string }> = [];
      const committed: string[] = [];

      try {
        for (const entry of staged) {
          if (await pathExists(entry.markdown_path)) {
            const backupPath = `${entry.markdown_path}.bak.${txnTag}`;
            await fs.rename(entry.markdown_path, backupPath);
            backups.push({ markdown_path: entry.markdown_path, backup_path: backupPath });
          }
        }

        for (const entry of staged) {
          await fs.rename(entry.staged_path, entry.markdown_path);
          committed.push(entry.markdown_path);
        }

        for (const backup of backups) {
          await removeIfExists(backup.backup_path);
        }
      } catch (e) {
        await cleanupPaths(staged.map((entry) => entry.staged_path));
        await cleanupPaths(committed);

        for (let i = backups.length - 1; i >= 0; i -= 1) {
          const backup = backups[i];
          if (await pathExists(backup.backup_path)) {
            await fs.rename(backup.backup_path, backup.markdown_path);
          }
        }

        return err("WRITE_FAILED", "wave_output_ingest failed during transactional commit", {
          message: String(e),
        });
      }

      const written = staged.map((entry) => ({
        perspective_id: entry.perspective_id,
        markdown_path: entry.markdown_path,
      }));

      return ok({
        manifest_path: manifestPath,
        perspectives_path: perspectivesPath,
        wave,
        run_root: runRoot,
        written_count: written.length,
        validated_count: written.length,
        outputs: written,
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "required file not found");
      if (e instanceof SyntaxError) return err("INVALID_JSON", "invalid JSON input", { message: String(e) });
      return err("WRITE_FAILED", "wave_output_ingest failed", { message: String(e) });
    }
  },
});

export const deep_research_wave_output_ingest = wave_output_ingest;
