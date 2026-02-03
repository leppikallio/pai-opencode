/**
 * PAI-OpenCode Context Loader
 *
 * Loads PAI skill context for injection into chat system.
 * Equivalent to PAI's load-core-context.ts hook.
 *
 * Compatible with PAI v2.4 (The Algorithm embedded in CORE/PAI).
 *
 * @module context-loader
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileLog, fileLogError } from "../lib/file-logger";
import type { ContextResult } from "../adapters/types";
import { getPaiDir } from "../lib/pai-runtime";
import { getIdentity, getPrincipal } from "../lib/identity";

function getRuntimeDir(): string {
  return getPaiDir();
}

/**
 * Read a file safely, returning empty string on error
 */
function readFileSafe(filePath: string): string {
  try {
    if (!existsSync(filePath)) {
      return "";
    }
    return readFileSync(filePath, "utf-8");
  } catch (error) {
    fileLogError(`Failed to read ${filePath}`, error);
    return "";
  }
}

function applyRuntimeTemplateVars(content: string): string {
  // OpenCode/PAI docs often use placeholders like {AI_NAME} or {daidentity.name}.
  // Replace them with runtime identity so the model doesn't echo raw placeholders.
  const identity = getIdentity();
  const principal = getPrincipal();

  return content
    .replace(/\{AI_NAME\}/g, identity.name)
    .replace(/\{daidentity\.name\}/g, identity.name)
    .replace(/\{DAIDENTITY\.NAME\}/g, identity.name)
    .replace(/\{principal\.name\}/g, principal.name);
}

/**
 * Load PAI skill context (fallback to CORE alias)
 *
 * Reads:
 * - SKILL.md (skill definition)
 * - SYSTEM/*.md (system docs)
 * - USER/TELOS/*.md (personal context, if exists)
 *
 * @returns ContextResult with the combined context string
 */
export async function loadContext(): Promise<ContextResult> {
  try {
    const paiDir = getRuntimeDir();
    const paiSkillDir = join(paiDir, "skills", "PAI");
    const coreSkillDir = join(paiDir, "skills", "CORE");
    const skillDir = existsSync(paiSkillDir) ? paiSkillDir : coreSkillDir;
    const skillLabel = existsSync(paiSkillDir) ? "PAI" : "CORE";

    fileLog(`Loading context from: ${skillDir}`);

    // Check if PAI (or CORE fallback) skill exists
    if (!existsSync(skillDir)) {
      fileLog("PAI skill directory not found", "warn");
      return {
        context: "",
        success: false,
        error: "PAI skill not found",
      };
    }

    const contextParts: string[] = [];

    // 1. Load SKILL.md
    const skillPath = join(skillDir, "SKILL.md");
    const skillContent = applyRuntimeTemplateVars(readFileSafe(skillPath));
    if (skillContent) {
      contextParts.push(`--- ${skillLabel} SKILL ---\n${skillContent}`);
      fileLog("Loaded SKILL.md");
    }

    // 2. Load SYSTEM docs (if exists) - v2.4 compatible
    const systemDir = join(skillDir, "SYSTEM");
    if (existsSync(systemDir)) {
      // Priority SYSTEM files for v2.4
      const systemFiles = [
        "SkillSystem.md",           // Skill system documentation
        "PAIAGENTSYSTEM.md",        // Agent system
        "THEPLUGINSYSTEM.md",       // Plugin system (OpenCode specific)
        "PAISYSTEMARCHITECTURE.md", // v2.4: System architecture
        "RESPONSEFORMAT.md",        // v2.4: Response format rules
      ];

      for (const file of systemFiles) {
        const filePath = join(systemDir, file);
        const content = applyRuntimeTemplateVars(readFileSafe(filePath));
        if (content) {
          contextParts.push(`--- ${file} ---\n${content}`);
          fileLog(`Loaded SYSTEM/${file}`);
        }
      }
    }

    // 3. Load USER/TELOS context (if exists) - v2.4 compatible
    const telosDir = join(skillDir, "USER", "TELOS");
    if (existsSync(telosDir)) {
      // Priority TELOS files for v2.4 (most important first)
      const telosFiles = [
        "TELOS.md",      // Main TELOS document
        "MISSION.md",    // v2.4: Mission statement
        "GOALS.md",      // Goals
        "NARRATIVES.md", // v2.4: Personal narratives
        "STATUS.md",     // v2.4: Current status
      ];

        for (const file of telosFiles) {
          const filePath = join(telosDir, file);
          const content = applyRuntimeTemplateVars(readFileSafe(filePath));
          if (content) {
            contextParts.push(`--- USER/TELOS/${file} ---\n${content}`);
            fileLog(`Loaded USER/TELOS/${file}`);
          }
        }
      }

    // 4. Load USER identity files - v2.4 compatible
    const userDir = join(skillDir, "USER");
    const userFiles = [
      "ABOUTME.md",           // User profile
      "BASICINFO.md",         // v2.4: Basic information
      "DAIDENTITY.md",        // v2.4: AI identity configuration
      "TECHSTACKPREFERENCES.md", // v2.4: Tech stack preferences
      "RESPONSEFORMAT.md",    // v2.4: Response format preferences
    ];

    for (const file of userFiles) {
      const filePath = join(userDir, file);
      const content = applyRuntimeTemplateVars(readFileSafe(filePath));
      if (content) {
        contextParts.push(`--- USER/${file} ---\n${content}`);
        fileLog(`Loaded USER/${file}`);
      }
    }

    // Combine all context
    if (contextParts.length === 0) {
      fileLog("No context files found", "warn");
      return {
        context: "",
        success: false,
        error: "No context files found",
      };
    }

    const context = `<system-reminder>
PAI CORE CONTEXT (Auto-loaded by PAI-OpenCode Plugin)

${contextParts.join("\n\n")}

---
This context is active for this session.
</system-reminder>`;

    fileLog(
      `Context loaded successfully (${contextParts.length} parts, ${context.length} chars)`
    );

    return {
      context,
      success: true,
    };
  } catch (error) {
    fileLogError("Failed to load context", error);
    return {
      context: "",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
