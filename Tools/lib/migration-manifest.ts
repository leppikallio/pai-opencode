import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, basename, dirname } from "path";

// ============================================================================
// Types
// ============================================================================

export interface SourceDetection {
  path: string;
  type: "pai-claudecode";
  detected: {
    hooks: string[];
    skills: string[];
    agents: string[];
    customizations: {
      daidentity: boolean;
      permissions: boolean;
      mcpServers: number;
      telosCustomized: boolean;
      customSkills: string[];
    };
  };
}

export interface Transformation {
  type: "directory" | "hook-to-plugin" | "content-update" | "self-check-update" | "file-copy";
  source: string;
  target: string;
  status: "done" | "template-generated" | "skipped" | "failed";
  details?: string;
}

export interface ValidationRequirement {
  id: string;
  description: string;
  type: "deterministic" | "llm-assisted";
  critical: boolean;
}

export interface MigrationManifest {
  version: string;
  timestamp: string;
  source: SourceDetection;
  transformations: Transformation[];
  validationGateResults: Array<{
    file: string;
    choice: "overwrite" | "keep" | "merge" | "defer";
  }>;
  validation: {
    required: ValidationRequirement[];
    passed?: string[];
    failed?: string[];
  };
}

// ============================================================================
// Constants
// ============================================================================

const STANDARD_SKILLS = [
  "CORE",
  "Agents",
  "Browser",
  "Art",
  "Research",
  "Security",
  "THEALGORITHM",
  "SpecFirst",
  "System",
  "FirstPrinciples",
  "Council",
  "RedTeam",
  "BeCreative",
  "Fabric",
  "pdf",
];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Creates an empty migration manifest
 */
export function createManifest(source: string): MigrationManifest {
  return {
    version: "0.9.7",
    timestamp: new Date().toISOString(),
    source: {
      path: source,
      type: "pai-claudecode",
      detected: {
        hooks: [],
        skills: [],
        agents: [],
        customizations: {
          daidentity: false,
          permissions: false,
          mcpServers: 0,
          telosCustomized: false,
          customSkills: [],
        },
      },
    },
    transformations: [],
    validationGateResults: [],
    validation: {
      required: [],
    },
  };
}

/**
 * Detects source structure and customizations
 */
export function detectSource(sourcePath: string): SourceDetection {
  const detection: SourceDetection = {
    path: sourcePath,
    type: "pai-claudecode",
    detected: {
      hooks: [],
      skills: [],
      agents: [],
      customizations: {
        daidentity: false,
        permissions: false,
        mcpServers: 0,
        telosCustomized: false,
        customSkills: [],
      },
    },
  };

  // Detect hooks
  const hooksDir = join(sourcePath, "hooks");
  if (existsSync(hooksDir)) {
    const hookFiles = readdirSync(hooksDir).filter(
      (f) => f.endsWith(".ts") || f.endsWith(".js")
    );
    detection.detected.hooks = hookFiles;
  }

  // Detect skills
  const skillsDir = join(sourcePath, "skills");
  if (existsSync(skillsDir)) {
    const skillDirs = readdirSync(skillsDir).filter((f) => {
      const fullPath = join(skillsDir, f);
      return statSync(fullPath).isDirectory();
    });
    detection.detected.skills = skillDirs;

    // Identify custom skills (not in standard list)
    detection.detected.customizations.customSkills = skillDirs.filter(
      (skill) => !STANDARD_SKILLS.includes(skill)
    );
  }

  // Detect agents
  const agentsDir = join(sourcePath, "agents");
  if (existsSync(agentsDir)) {
    const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    detection.detected.agents = agentFiles;
  }

  // Check settings.json for customizations
  const settingsPath = join(sourcePath, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));

      // Check for DA identity customization
      if (settings.DA || settings.ENGINEER_NAME) {
        detection.detected.customizations.daidentity = true;
      }

      // Check for custom permissions
      if (settings.claudePermissions) {
        detection.detected.customizations.permissions = true;
      }

      // Count MCP servers
      if (settings.mcpServers) {
        const servers = settings.mcpServers;
        detection.detected.customizations.mcpServers = Object.keys(
          typeof servers === "object" ? servers : {}
        ).length;
      }
    } catch (error) {
      console.warn(`Failed to parse settings.json: ${error}`);
    }
  }

  // Check if TELOS.md is customized
  const telosPath = join(sourcePath, "TELOS.md");
  if (existsSync(telosPath)) {
    const telosContent = readFileSync(telosPath, "utf-8");
    // Check if it's not the default template by looking for specific customizations
    // A customized TELOS would have specific project goals, not placeholders
    const hasPlaceholders =
      telosContent.includes("[Your") ||
      telosContent.includes("TODO") ||
      telosContent.includes("PLACEHOLDER");
    detection.detected.customizations.telosCustomized = !hasPlaceholders;
  }

  return detection;
}

/**
 * Adds a transformation record to the manifest
 */
export function addTransformation(
  manifest: MigrationManifest,
  transformation: Transformation
): void {
  manifest.transformations.push(transformation);
}

/**
 * Adds a validation gate result to the manifest
 */
export function addValidationGateResult(
  manifest: MigrationManifest,
  file: string,
  choice: "overwrite" | "keep" | "merge" | "defer"
): void {
  manifest.validationGateResults.push({ file, choice });
}

/**
 * Adds a validation requirement to the manifest
 */
export function addValidationRequirement(
  manifest: MigrationManifest,
  requirement: ValidationRequirement
): void {
  manifest.validation.required.push(requirement);
}

/**
 * Writes the manifest to disk
 */
export function writeManifest(
  manifest: MigrationManifest,
  targetPath: string
): void {
  const manifestPath = join(targetPath, "MIGRATION-MANIFEST.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`✓ Migration manifest written to ${manifestPath}`);
}

/**
 * Reads a manifest from disk
 */
export function readManifest(manifestPath: string): MigrationManifest {
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  try {
    const content = readFileSync(manifestPath, "utf-8");
    return JSON.parse(content) as MigrationManifest;
  } catch (error) {
    throw new Error(`Failed to parse manifest: ${error}`);
  }
}

/**
 * Updates validation results in the manifest
 */
export function updateValidationResults(
  manifest: MigrationManifest,
  passed: string[],
  failed: string[]
): void {
  manifest.validation.passed = passed;
  manifest.validation.failed = failed;
}

/**
 * Gets a summary of the manifest
 */
export function getManifestSummary(manifest: MigrationManifest): string {
  const { source, transformations, validationGateResults, validation } = manifest;
  const detected = source.detected;
  const customizations = source.detected.customizations;

  const lines = [
    "Migration Manifest Summary",
    "=========================",
    "",
    `Version: ${manifest.version}`,
    `Timestamp: ${manifest.timestamp}`,
    `Source: ${source.path}`,
    "",
    "Detected:",
    `  Hooks: ${detected.hooks.length}`,
    `  Skills: ${detected.skills.length}`,
    `  Agents: ${detected.agents.length}`,
    `  MCP Servers: ${customizations.mcpServers}`,
    `  Custom Skills: ${customizations.customSkills.join(", ") || "none"}`,
    `  DA Identity: ${customizations.daidentity ? "yes" : "no"}`,
    `  TELOS Customized: ${customizations.telosCustomized ? "yes" : "no"}`,
    "",
    `Transformations: ${transformations.length}`,
    `  Done: ${transformations.filter((t) => t.status === "done").length}`,
    `  Template Generated: ${transformations.filter((t) => t.status === "template-generated").length}`,
    `  Skipped: ${transformations.filter((t) => t.status === "skipped").length}`,
    `  Failed: ${transformations.filter((t) => t.status === "failed").length}`,
    "",
    `Validation Gates: ${validationGateResults.length}`,
    `  Overwrite: ${validationGateResults.filter((r) => r.choice === "overwrite").length}`,
    `  Keep: ${validationGateResults.filter((r) => r.choice === "keep").length}`,
    `  Merge: ${validationGateResults.filter((r) => r.choice === "merge").length}`,
    `  Defer: ${validationGateResults.filter((r) => r.choice === "defer").length}`,
    "",
    `Validation Requirements: ${validation.required.length}`,
    `  Critical: ${validation.required.filter((r) => r.critical).length}`,
    `  Deterministic: ${validation.required.filter((r) => r.type === "deterministic").length}`,
    `  LLM-Assisted: ${validation.required.filter((r) => r.type === "llm-assisted").length}`,
  ];

  if (validation.passed) {
    lines.push(`  Passed: ${validation.passed.length}`);
  }
  if (validation.failed) {
    lines.push(`  Failed: ${validation.failed.length}`);
  }

  return lines.join("\n");
}

/**
 * Validates manifest structure
 */
export function validateManifestStructure(manifest: MigrationManifest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!manifest.version) {
    errors.push("Missing version");
  }

  if (!manifest.timestamp) {
    errors.push("Missing timestamp");
  }

  if (!manifest.source || !manifest.source.path) {
    errors.push("Missing source path");
  }

  if (!Array.isArray(manifest.transformations)) {
    errors.push("Transformations must be an array");
  }

  if (!Array.isArray(manifest.validationGateResults)) {
    errors.push("Validation gate results must be an array");
  }

  if (!manifest.validation || !Array.isArray(manifest.validation.required)) {
    errors.push("Validation requirements must be an array");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
