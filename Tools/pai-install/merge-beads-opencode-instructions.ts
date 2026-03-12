import fs from "node:fs";
import path from "node:path";

import {
  buildOwnedInstructionPathKeys,
  isOwnedInstructionEntry,
} from "./merge-opencode-instruction-paths";

type JsonRecord = Record<string, unknown>;

export type MergeBeadsOpencodeInstructionsArgs = {
  targetDir: string;
};

export type MergeBeadsOpencodeInstructionsResult = {
  opencodeConfigPath: string;
  backupPath: string | null;
  changed: boolean;
};

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw: string, filePath: string): JsonRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON at ${filePath}: ${reason}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`Expected JSON object at ${filePath}`);
  }

  return parsed;
}

function readJsonObjectOrEmpty(filePath: string): JsonRecord {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return {};
  }

  return parseJsonObject(raw, filePath);
}

export function mergeBeadsOpencodeInstructions(
  args: MergeBeadsOpencodeInstructionsArgs,
): MergeBeadsOpencodeInstructionsResult {
  const opencodeConfigPath = path.join(args.targetDir, "opencode.json");
  const runtimeConfigDir = path.dirname(opencodeConfigPath);
  const backupsDir = path.join(args.targetDir, "BACKUPS");
  const backupPath = path.join(backupsDir, `opencode.json.${Date.now()}.bak`);

  const existingConfig = readJsonObjectOrEmpty(opencodeConfigPath);
  const existingInstructionsRaw = Array.isArray(existingConfig.instructions)
    ? existingConfig.instructions
    : [];

  const ownedBdPathKeys = buildOwnedInstructionPathKeys({
    targetDir: args.targetDir,
    instructionFileName: "BD.md",
  });

  const preservedInstructions = existingInstructionsRaw.filter(
    (entry) =>
      !isOwnedInstructionEntry({
        entry,
        ownedPathKeys: ownedBdPathKeys,
        configDir: runtimeConfigDir,
      }),
  );

  const canonicalRuntimeBdPath = path.resolve(path.join(args.targetDir, "BD.md"));
  const mergedInstructions = [...preservedInstructions, canonicalRuntimeBdPath];

  const mergedConfig: JsonRecord = {
    ...existingConfig,
    instructions: mergedInstructions,
  };

  const currentContent = `${JSON.stringify(existingConfig, null, 2)}\n`;
  const nextContent = `${JSON.stringify(mergedConfig, null, 2)}\n`;
  const changed = currentContent !== nextContent;

  let writtenBackupPath: string | null = null;
  if (changed) {
    fs.mkdirSync(path.dirname(opencodeConfigPath), { recursive: true });
    if (fs.existsSync(opencodeConfigPath)) {
      fs.mkdirSync(backupsDir, { recursive: true });
      fs.copyFileSync(opencodeConfigPath, backupPath);
      writtenBackupPath = backupPath;
    }
    fs.writeFileSync(opencodeConfigPath, nextContent, "utf8");
  }

  return {
    opencodeConfigPath,
    backupPath: writtenBackupPath,
    changed,
  };
}
