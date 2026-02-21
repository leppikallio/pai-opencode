import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  countWords,
  err,
  errorCode,
  findHeadingSection,
  hasHeading,
  isPlainObject,
  ok,
  parseSourcesSection,
  readJson,
  validatePerspectivesV1,
} from "./wave_tools_shared";

function sidecarCandidates(markdownPath: string, perspectiveId: string): string[] {
  const candidates = new Set<string>();
  const dir = path.dirname(markdownPath);
  candidates.add(path.join(dir, `${perspectiveId}.meta.json`));
  if (markdownPath.endsWith(".md")) {
    candidates.add(`${markdownPath.slice(0, -3)}.meta.json`);
  } else {
    candidates.add(`${markdownPath}.meta.json`);
  }
  return Array.from(candidates);
}

async function readToolUsageFromSidecar(args: {
  markdownPath: string;
  perspectiveId: string;
  budgetKeys: string[];
}): Promise<{ usage: Record<string, number>; sidecar_path: string | null; sidecar_found: boolean } | string> {
  const usage: Record<string, number> = {};
  for (const key of args.budgetKeys) usage[key] = 0;

  const candidates = sidecarCandidates(args.markdownPath, args.perspectiveId);
  for (const candidatePath of candidates) {
    let sidecarRaw: unknown;
    try {
      sidecarRaw = await readJson(candidatePath);
    } catch (e) {
      if (errorCode(e) === "ENOENT") continue;
      if (e instanceof SyntaxError) {
        return err("INVALID_JSON", "wave output sidecar contains invalid JSON", {
          sidecar_path: candidatePath,
        });
      }
      throw e;
    }

    if (!isPlainObject(sidecarRaw)) {
      return err("INVALID_JSON", "wave output sidecar must be a JSON object", {
        sidecar_path: candidatePath,
      });
    }

    const toolUsageRaw = sidecarRaw.tool_usage;
    if (toolUsageRaw !== undefined && !isPlainObject(toolUsageRaw)) {
      return err("INVALID_TOOL_USAGE", "wave output sidecar tool_usage must be an object", {
        sidecar_path: candidatePath,
      });
    }

    const toolUsage = isPlainObject(toolUsageRaw)
      ? (toolUsageRaw as Record<string, unknown>)
      : {};

    for (const key of args.budgetKeys) {
      const rawCount = Number(toolUsage[key] ?? 0);
      if (!Number.isFinite(rawCount) || rawCount < 0) {
        return err("INVALID_TOOL_USAGE", "wave output sidecar tool usage must be non-negative numbers", {
          sidecar_path: candidatePath,
          tool: key,
          recorded: toolUsage[key] ?? null,
        });
      }
      usage[key] = rawCount;
    }

    return {
      usage,
      sidecar_path: candidatePath,
      sidecar_found: true,
    };
  }

  return {
    usage,
    sidecar_path: null,
    sidecar_found: false,
  };
}

export const wave_output_validate = tool({
  description: "Validate Wave output markdown contract for a single perspective",
  args: {
    perspectives_path: tool.schema.string().describe("Absolute path to perspectives.json (perspectives.v1)"),
    perspective_id: tool.schema.string().describe("Perspective id to validate against"),
    markdown_path: tool.schema.string().describe("Absolute path to markdown output"),
  },
  async execute(args: { perspectives_path: string; perspective_id: string; markdown_path: string }) {
    try {
      const perspectivesPath = args.perspectives_path.trim();
      const perspectiveId = args.perspective_id.trim();
      const markdownPath = args.markdown_path.trim();

      if (!perspectivesPath) return err("INVALID_ARGS", "perspectives_path must be non-empty");
      if (!path.isAbsolute(perspectivesPath)) {
        return err("INVALID_ARGS", "perspectives_path must be absolute", { perspectives_path: args.perspectives_path });
      }
      if (!perspectiveId) return err("INVALID_ARGS", "perspective_id must be non-empty");
      if (!markdownPath) return err("INVALID_ARGS", "markdown_path must be non-empty");
      if (!path.isAbsolute(markdownPath)) {
        return err("INVALID_ARGS", "markdown_path must be absolute", { markdown_path: args.markdown_path });
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
      const perspective = ((perspectivesDoc.perspectives as Array<Record<string, unknown>>) ?? [])
        .find((entry) => String(entry.id ?? "") === perspectiveId);

      if (!perspective) {
        return err("PERSPECTIVE_NOT_FOUND", "perspective_id not found", {
          perspective_id: perspectiveId,
        });
      }

      const contract = perspective.prompt_contract as Record<string, unknown>;
      const maxWords = Number(contract.max_words ?? 0);
      const maxSources = Number(contract.max_sources ?? 0);
      const toolBudgetRaw = isPlainObject(contract.tool_budget)
        ? (contract.tool_budget as Record<string, unknown>)
        : {};
      const toolBudget: Record<string, number> = {};
      for (const [tool, rawLimit] of Object.entries(toolBudgetRaw)) {
        const normalizedTool = String(tool ?? "").trim();
        if (!normalizedTool) continue;
        const limit = Number(rawLimit ?? Number.NaN);
        if (!Number.isFinite(limit) || limit < 0) {
          return err("INVALID_TOOL_BUDGET", "prompt_contract.tool_budget entries must be non-negative numbers", {
            tool: normalizedTool,
            limit: rawLimit ?? null,
          });
        }
        toolBudget[normalizedTool] = limit;
      }
      const requiredSections = Array.isArray(contract.must_include_sections)
        ? contract.must_include_sections.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)
        : [];

      let markdown: string;
      try {
        markdown = await fs.promises.readFile(markdownPath, "utf8");
      } catch (e) {
        if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "markdown_path not found", { markdown_path: markdownPath });
        throw e;
      }

      const missingSections = requiredSections.filter((section) => !hasHeading(markdown, section));
      if (missingSections.length > 0) {
        return err("MISSING_REQUIRED_SECTION", `Missing section: ${missingSections[0]}`, {
          section: missingSections[0],
          missing_sections: missingSections,
        });
      }

      const words = countWords(markdown);
      if (words > maxWords) {
        return err("TOO_MANY_WORDS", "word count exceeds max_words", {
          max_words: maxWords,
          words,
        });
      }

      let sources = 0;
      const sourceHeading = requiredSections.find((section) => section.toLowerCase() === "sources");
      if (sourceHeading) {
        const sourcesSection = findHeadingSection(markdown, sourceHeading);
        if (sourcesSection === null) {
          return err("MISSING_REQUIRED_SECTION", "Missing section: Sources", {
            section: "Sources",
          });
        }

        const parsedSources = parseSourcesSection(sourcesSection);
        if (parsedSources.ok === false) {
          return err("MALFORMED_SOURCES", "sources section has malformed entries", {
            line: parsedSources.line,
            reason: parsedSources.reason,
          });
        }

        sources = parsedSources.count;
        if (sources > maxSources) {
          return err("TOO_MANY_SOURCES", "sources exceed max_sources", {
            max_sources: maxSources,
            sources,
          });
        }
      }

      const budgetKeys = Object.keys(toolBudget);
      const usageOrErr = await readToolUsageFromSidecar({
        markdownPath,
        perspectiveId,
        budgetKeys,
      });
      if (typeof usageOrErr === "string") return usageOrErr;

      for (const tool of budgetKeys) {
        const limit = toolBudget[tool] ?? 0;
        const recorded = usageOrErr.usage[tool] ?? 0;
        if (recorded > limit) {
          return err("TOOL_BUDGET_EXCEEDED", "recorded tool usage exceeds prompt_contract.tool_budget", {
            tool,
            limit,
            recorded,
            sidecar_path: usageOrErr.sidecar_path,
          });
        }
      }

      return ok({
        perspective_id: perspectiveId,
        markdown_path: markdownPath,
        words,
        sources,
        tool_budget: toolBudget,
        tool_usage: usageOrErr.usage,
        sidecar_path: usageOrErr.sidecar_path,
        sidecar_found: usageOrErr.sidecar_found,
        missing_sections: [],
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "perspectives_path or markdown_path not found");
      return err("WRITE_FAILED", "wave output validation failed", { message: String(e) });
    }
  },
});
