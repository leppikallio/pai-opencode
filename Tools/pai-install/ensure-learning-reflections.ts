import fs from "node:fs";
import path from "node:path";

export type EnsureLearningReflectionsArtifactsArgs = {
  targetDir: string;
  dryRun: boolean;
};

export type EnsureLearningReflectionsArtifactsResult = {
  reflectionsDir: string;
  reflectionsFile: string;
  createdDir: boolean;
  createdFile: boolean;
};

const REFLECTIONS_DIR_REL = path.join("MEMORY", "LEARNING", "REFLECTIONS");
const REFLECTIONS_FILE_NAME = "algorithm-reflections.jsonl";

export function ensureLearningReflectionsArtifacts(
  args: EnsureLearningReflectionsArtifactsArgs,
): EnsureLearningReflectionsArtifactsResult {
  const reflectionsDir = path.join(args.targetDir, REFLECTIONS_DIR_REL);
  const reflectionsFile = path.join(reflectionsDir, REFLECTIONS_FILE_NAME);
  const prefix = args.dryRun ? "[dry]" : "[seed]";

  let createdDir = false;
  let createdFile = false;

  if (args.dryRun) {
    console.log(`${prefix} learning reflections bootstrap`);
    return { reflectionsDir, reflectionsFile, createdDir, createdFile };
  }

  createdDir = !fs.existsSync(reflectionsDir);
  fs.mkdirSync(reflectionsDir, { recursive: true });

  if (!fs.existsSync(reflectionsFile)) {
    fs.writeFileSync(reflectionsFile, "", "utf8");
    createdFile = true;
    console.log(`${prefix} learning reflections bootstrap`);
  }

  return { reflectionsDir, reflectionsFile, createdDir, createdFile };
}
