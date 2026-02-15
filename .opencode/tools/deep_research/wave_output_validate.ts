import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  countWords,
  err,
  errorCode,
  findHeadingSection,
  hasHeading,
  ok,
  parseSourcesSection,
  readJson,
  validatePerspectivesV1,
} from "./wave_tools_shared";

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

      return ok({
        perspective_id: perspectiveId,
        markdown_path: markdownPath,
        words,
        sources,
        missing_sections: [],
      });
    } catch (e) {
      if (errorCode(e) === "ENOENT") return err("NOT_FOUND", "perspectives_path or markdown_path not found");
      return err("WRITE_FAILED", "wave output validation failed", { message: String(e) });
    }
  },
});
