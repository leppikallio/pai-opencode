import * as fs from "node:fs";
import * as path from "node:path";
import { fileLog, fileLogError } from "../lib/file-logger";
import { ensureDir, getLearningDir, getStateDir, getYearMonth, getMemoryDir } from "../lib/paths";
import { getPrincipalName, getDAName } from "../lib/identity";

export type SoulUpdateSection = "who_i_am" | "core_values" | "learned" | "figuring_out";

export type SoulUpdate = {
  id: string;
  section: SoulUpdateSection;
  proposed: string;
  reason: string;
  created: string;
  status: "pending" | "approved" | "rejected" | "applied";
  requiresApproval: boolean;
};

export type EvolutionQueue = {
  updates: SoulUpdate[];
  lastProcessed: string;
};

function safeRead(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function listMd(dir: string, limit: number): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function loadEvolutionQueue(): EvolutionQueue {
  const queuePath = path.join(getStateDir(), "soul-evolution-queue.json");
  try {
    if (fs.existsSync(queuePath)) {
      return JSON.parse(fs.readFileSync(queuePath, "utf-8"));
    }
  } catch {
    // ignore
  }
  return { updates: [], lastProcessed: new Date().toISOString() };
}

async function saveEvolutionQueue(queue: EvolutionQueue): Promise<void> {
  await ensureDir(getStateDir());
  const queuePath = path.join(getStateDir(), "soul-evolution-queue.json");
  await fs.promises.writeFile(queuePath, JSON.stringify(queue, null, 2));
}

function analyzeSoulEvolution(texts: string[]): SoulUpdate[] {
  const combined = texts.join("\n");
  if (!combined.trim()) return [];

  const principal = getPrincipalName();
  const da = getDAName();

  const updates: SoulUpdate[] = [];
  const now = new Date().toISOString();

  const figuring = combined.match(/(?:still\s+(?:figuring|working|trying|uncertain|unsure)[^.\n]*)/gi) || [];
  for (const m of figuring.slice(0, 2)) {
    const proposed = `- ${m.trim()}`;
    updates.push({
      id: `figuring-${Buffer.from(proposed).toString('base64').slice(0, 12)}`,
      section: "figuring_out",
      proposed,
      reason: `Detected uncertainty pattern in recent sessions (${da} ↔ ${principal})`,
      created: now,
      status: "pending",
      requiresApproval: true,
    });
  }

  const learned = combined.match(/\bI\s+(?:realize|notice|understand|learned|discovered)[^.\n]*/gi) || [];
  for (const m of learned.slice(0, 2)) {
    const proposed = `- ${m.trim()}`;
    updates.push({
      id: `learned-${Buffer.from(proposed).toString('base64').slice(0, 12)}`,
      section: "learned",
      proposed,
      reason: `Self-reflection detected in recent sessions (${da})`,
      created: now,
      status: "pending",
      requiresApproval: true,
    });
  }

  return updates;
}

export async function captureSoulEvolution(): Promise<void> {
  try {
    // Inputs:
    // - recent learnings (ALGORITHM + SYSTEM)
    // - recent relationship notes
    const ym = getYearMonth();
    const learningDir = getLearningDir();

    const algDir = path.join(learningDir, "ALGORITHM", ym);
    const sysDir = path.join(learningDir, "SYSTEM", ym);
    const learningFiles = [...listMd(algDir, 8), ...listMd(sysDir, 8)];
    const learningTexts = learningFiles.map(safeRead).filter(Boolean).slice(0, 10);

    const relDir = path.join(getMemoryDir(), "RELATIONSHIP", ym);
    const relFiles = listMd(relDir, 3);
    const relTexts = relFiles.map(safeRead).filter(Boolean).slice(0, 3);

    const texts = [...learningTexts, ...relTexts];
    const updates = analyzeSoulEvolution(texts);
    const queue = loadEvolutionQueue();

    if (updates.length > 0) {
      const existing = new Set(queue.updates.map((u) => `${u.section}:${u.proposed}`));
      for (const u of updates) {
        const key = `${u.section}:${u.proposed}`;
        if (existing.has(key)) continue;
        queue.updates.push(u);
        existing.add(key);
      }
    }

    queue.lastProcessed = new Date().toISOString();
    await saveEvolutionQueue(queue);
    fileLog(`SoulEvolution queue updated (updates=${updates.length})`, "debug");
  } catch (error) {
    fileLogError("Soul evolution capture failed", error);
  }
}
