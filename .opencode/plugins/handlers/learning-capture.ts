/**
 * Learning Capture Handler
 *
 * Equivalent to PAI v2.4 WorkCompletionLearning hook.
 * Extracts learnings from completed work sessions and bridges
 * MEMORY/WORK/ to MEMORY/LEARNING/
 *
 * @module learning-capture
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileLog, fileLogError } from "../lib/file-logger";
import {
  getLearningDir,
  getYearMonth,
  getTimestamp,
  ensureDir,
  getCurrentWorkPath,
  slugify,
} from "../lib/paths";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getStringProp(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Learning entry structure
 */
export interface LearningEntry {
  title: string;
  content: string;
  category: string;
  source: string;
  timestamp: string;
  score?: number;
}

/**
 * Capture learning result
 */
export interface CaptureLearningResult {
  success: boolean;
  learnings: LearningEntry[];
  error?: string;
}

/**
 * Learning categories
 */
const CATEGORIES = {
  ALGORITHM: "ALGORITHM", // Process improvements
  SYSTEM: "SYSTEM", // Technical improvements
  CODE: "CODE", // Code patterns
  RESPONSE: "RESPONSE", // Response format
  GENERAL: "GENERAL", // General learnings
} as const;

/**
 * Detect learning category from content
 */
function detectCategory(content: string): string {
  const lower = content.toLowerCase();

  if (/algorithm|phase|isc|execute|verify|observe|think|plan|build/i.test(lower)) {
    return CATEGORIES.ALGORITHM;
  }
  if (/system|config|hook|plugin|infrastructure|architecture/i.test(lower)) {
    return CATEGORIES.SYSTEM;
  }
  if (/code|function|class|method|bug|fix|refactor/i.test(lower)) {
    return CATEGORIES.CODE;
  }
  if (/response|format|output|voice|display/i.test(lower)) {
    return CATEGORIES.RESPONSE;
  }

  return CATEGORIES.GENERAL;
}

/**
 * Extract learnings from work session
 *
 * Looks for:
 * - Patterns like "Learning:", "Learned:", "Key insight:"
 * - ISC.json for completed criteria
 * - THREAD.md for significant content
 */
export async function extractLearningsFromWork(): Promise<CaptureLearningResult> {
  try {
    const workPath = await getCurrentWorkPath();
    if (!workPath) {
      fileLog("No active work session for learning extraction", "debug");
      return { success: true, learnings: [] };
    }

    const learnings: LearningEntry[] = [];

    // 1. Check THREAD.md for learning patterns
    const threadPath = path.join(workPath, "THREAD.md");
    try {
      const threadContent = await fs.promises.readFile(threadPath, "utf-8");
      const threadLearnings = extractLearningsFromText(threadContent, "THREAD.md");
      learnings.push(...threadLearnings);
    } catch {
      // THREAD.md might not exist
    }

    // 2. Check ISC.json for completed criteria
    const iscPath = path.join(workPath, "ISC.json");
    try {
      const iscContent = await fs.promises.readFile(iscPath, "utf-8");
      const isc = JSON.parse(iscContent);

      // Extract learnings from completed criteria
      if (Array.isArray(isc.criteria)) {
        const completed = isc.criteria.filter((c: unknown) => {
          const status = getStringProp(c, "status")?.toUpperCase();
          return status === "DONE" || status === "VERIFIED";
        });

        if (completed.length > 0) {
          const iscLearning: LearningEntry = {
            title: "ISC Completion Summary",
            content: `Completed ${completed.length} criteria:\n\n${completed
              .map((c: unknown) => {
                const description =
                  getStringProp(c, "text") ?? getStringProp(c, "description") ?? "(no description)";
                const status = getStringProp(c, "status") ?? "UNKNOWN";
                return `- ${description}: ${status}`;
              })
              .join("\n")}`,
            category: CATEGORIES.ALGORITHM,
            source: "ISC.json",
            timestamp: new Date().toISOString(),
          };
          learnings.push(iscLearning);
        }
      }
    } catch {
      // ISC.json might not exist or be invalid
    }

    // 3. Check scratch/ for any markdown files with insights
    const scratchDir = path.join(workPath, "scratch");
    try {
      const scratchFiles = await fs.promises.readdir(scratchDir);
      for (const file of scratchFiles.filter((f) => f.endsWith(".md"))) {
        try {
          const content = await fs.promises.readFile(
            path.join(scratchDir, file),
            "utf-8"
          );
          const scratchLearnings = extractLearningsFromText(content, `scratch/${file}`);
          learnings.push(...scratchLearnings);
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // scratch/ might not exist
    }

    // Persist learnings
    for (const learning of learnings) {
      await persistLearning(learning);
    }

    fileLog(`Extracted ${learnings.length} learnings from work session`, "info");
    return { success: true, learnings };
  } catch (error) {
    fileLogError("Failed to extract learnings", error);
    return {
      success: false,
      learnings: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Extract learnings from text content
 */
function extractLearningsFromText(
  content: string,
  source: string
): LearningEntry[] {
  const learnings: LearningEntry[] = [];

  // Pattern: "Learning: ..." or "Learned: ..." or "Key insight: ..."
  const patterns = [
    /(?:Learning|Learned|Key insight|Insight|Takeaway):\s*(.+?)(?:\n\n|\n(?=[A-Z#*-]))/gis,
    /## (?:Learning|Learned|Key insight|Insight|Takeaway)[^\n]*\n\n(.+?)(?:\n##|\n---|$)/gis,
  ];

  for (const pattern of patterns) {
    for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
      const learningContent = match[1].trim();
      if (learningContent.length > 20) {
        // Skip very short matches
        learnings.push({
          title: learningContent.split("\n")[0].slice(0, 80),
          content: learningContent,
          category: detectCategory(learningContent),
          source,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  return learnings;
}

/**
 * Persist learning to MEMORY/LEARNING/
 */
async function persistLearning(learning: LearningEntry): Promise<string | null> {
  try {
    const learningDir = getLearningDir();
    const yearMonth = getYearMonth();
    const timestamp = getTimestamp();

    const categoryDir = path.join(learningDir, learning.category, yearMonth);
    await ensureDir(categoryDir);

    const slug = slugify(learning.title.slice(0, 30));
    const filename = `${timestamp}_work_${slug}.md`;
    const filepath = path.join(categoryDir, filename);

    const content = `# ${learning.title}

**Timestamp:** ${learning.timestamp}
**Category:** ${learning.category}
**Source:** ${learning.source}
**Score:** ${learning.score || 50}

---

${learning.content}

---

*Auto-extracted from work session*
`;

    await fs.promises.writeFile(filepath, content);
    fileLog(`Learning persisted: ${filename}`, "debug");
    return filepath;
  } catch (error) {
    fileLogError("Failed to persist learning", error);
    return null;
  }
}

/**
 * Create manual learning entry
 */
export async function createLearning(
  title: string,
  content: string,
  category?: string
): Promise<string | null> {
  const learning: LearningEntry = {
    title,
    content,
    category: category || detectCategory(content),
    source: "manual",
    timestamp: new Date().toISOString(),
  };

  return persistLearning(learning);
}

/**
 * Get recent learnings
 */
export async function getRecentLearnings(limit = 10): Promise<LearningEntry[]> {
  try {
    const learningDir = getLearningDir();
    const yearMonth = getYearMonth();

    const learnings: LearningEntry[] = [];

    for (const category of Object.values(CATEGORIES)) {
      const categoryDir = path.join(learningDir, category, yearMonth);

      try {
        const files = await fs.promises.readdir(categoryDir);
        const mdFiles = files
          .filter((f) => f.endsWith(".md"))
          .sort()
          .reverse()
          .slice(0, limit);

        for (const file of mdFiles) {
          try {
            const content = await fs.promises.readFile(
              path.join(categoryDir, file),
              "utf-8"
            );

            // Parse title
            const titleMatch = content.match(/^# (.+)/m);
            const title = titleMatch ? titleMatch[1] : file;

            learnings.push({
              title,
              content,
              category,
              source: file,
              timestamp: new Date().toISOString(),
            });
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // Category dir might not exist
      }
    }

    return learnings.slice(0, limit);
  } catch {
    return [];
  }
}
