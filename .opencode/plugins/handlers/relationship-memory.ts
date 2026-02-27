import * as fs from "node:fs";
import * as path from "node:path";
import { fileLog, fileLogError } from "../lib/file-logger";
import { ensureDir, getDateString, getMemoryDir, getYearMonth } from "../lib/paths";
import { getDAName, getPrincipalName } from "../lib/identity";
import { getCurrentWorkPathForSession } from "../lib/paths";
import { isEnvFlagEnabled, isMemoryParityEnabled } from "../lib/env-flags";

export type RelationshipNoteType = "W" | "B" | "O";

export type RelationshipNote = {
  type: RelationshipNoteType;
  entities: string[];
  content: string;
  confidence?: number;
};

function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

type ThreadBlock = { role: "user" | "assistant"; text: string };

const MAX_WORLD_NOTES = 2;
const MAX_WORLD_SNIPPET_LENGTH = 180;
const MAX_ASSISTANT_MARKER_SNIPPET_LENGTH = 220;

function extractAssistantMarkerSnippets(text: string): string[] {
  const snippets: string[] = [];
  const markerPatterns = [/📋 SUMMARY:\s*([^\n]+)/g, /🗣️\s*Marvin:\s*([^\n]+)/gi];

  for (const pattern of markerPatterns) {
    for (const match of text.matchAll(pattern)) {
      const snippet = (match[1] ?? "").trim();
      if (snippet) {
        snippets.push(capText(snippet, MAX_ASSISTANT_MARKER_SNIPPET_LENGTH));
      }
    }
  }

  return snippets;
}

function parseThreadBlocks(thread: string): ThreadBlock[] {
  const lines = thread.split("\n");
  const blocks: ThreadBlock[] = [];
  let current: ThreadBlock | null = null;

  function pushCurrent() {
    if (!current) return;
    const text = current.text.trim();
    if (text) blocks.push({ role: current.role, text });
    current = null;
  }

  for (const line of lines) {
    if (line.startsWith("**User:**")) {
      pushCurrent();
      current = { role: "user", text: line.replace("**User:**", "").trim() };
      continue;
    }
    if (line.startsWith("**Assistant:**")) {
      pushCurrent();
      current = { role: "assistant", text: line.replace("**Assistant:**", "").trim() };
      continue;
    }

    if (current) {
      current.text += `\n${line}`;
    }
  }

  pushCurrent();
  return blocks;
}

function analyzeForRelationship(users: string[], assistants: string[], includeWorldNotes: boolean): RelationshipNote[] {
  const notes: RelationshipNote[] = [];

  const da = getDAName();
  const principal = getPrincipalName();

  const patterns = {
    preference: /\b(prefer|like|want|appreciate|enjoy|love|hate|dislike)\b/i,
    frustration: /\b(frustrat|annoy|bother|irritat|ugh|wtf)\b/i,
    positive: /\b(great|awesome|perfect|excellent|good job|well done|nice|thanks|thank you)\b/i,
  };

  const sessionSummary: string[] = [];
  const preferenceSnippets: string[] = [];
  const worldSnippets: string[] = [];
  let positiveCount = 0;
  let frustrationCount = 0;

  for (const a of assistants.slice(-10)) {
    for (const snippet of extractAssistantMarkerSnippets(a)) {
      sessionSummary.push(snippet);
    }
  }

  for (const u of users.slice(-12)) {
    if (patterns.preference.test(u)) preferenceSnippets.push(capText(u, 180));
    if (patterns.positive.test(u)) positiveCount++;
    if (patterns.frustration.test(u)) frustrationCount++;

    if (includeWorldNotes) {
      for (const pattern of [/(?:^|\n)\s*world\s*(?:note|fact)\s*:\s*([^\n]+)/gi]) {
        for (const match of u.matchAll(pattern)) {
          const snippet = (match[1] ?? "").trim();
          if (snippet) {
            worldSnippets.push(capText(snippet, MAX_WORLD_SNIPPET_LENGTH));
          }
        }
      }
    }
  }

  // B (Biographical) notes: what happened this session.
  for (const s of [...new Set(sessionSummary)].slice(0, 3)) {
    notes.push({
      type: "B",
      entities: [`@${da}`],
      content: s,
    });
  }

  // O (Opinion) notes: inferred preferences.
  for (const p of [...new Set(preferenceSnippets)].slice(0, 2)) {
    notes.push({
      type: "O",
      entities: [`@${principal}`],
      content: p,
      confidence: 0.75,
    });
  }

  if (positiveCount >= 2) {
    notes.push({
      type: "O",
      entities: [`@${principal}`],
      content: "Responded positively to this session's approach",
      confidence: 0.7,
    });
  }

  if (frustrationCount >= 2) {
    notes.push({
      type: "O",
      entities: [`@${principal}`],
      content: "Showed frustration during this session (likely process/tooling)",
      confidence: 0.75,
    });
  }

  for (const w of [...new Set(worldSnippets)].slice(0, MAX_WORLD_NOTES)) {
    notes.push({
      type: "W",
      entities: ["@WORLD"],
      content: w,
      confidence: 0.85,
    });
  }

  return notes;
}

function hashNotesKey(notes: RelationshipNote[]): string {
  // A simple stable key to dedupe repeated idle captures.
  return notes
    .map((n) => `${n.type}|${n.entities.join(',')}|${n.content}`)
    .join('\n');
}

function formatNotes(notes: RelationshipNote[]): string {
  if (notes.length === 0) return "";

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");

  const lines: string[] = [];
  lines.push(`\n## ${hh}:${mm}`);
  lines.push("");
  for (const n of notes) {
    const entities = n.entities.join(" ");
    const conf = typeof n.confidence === "number" ? `(c=${n.confidence.toFixed(2)})` : "";
    lines.push(`- ${n.type}${conf} ${entities}: ${n.content}`);
  }
  lines.push("");
  return lines.join("\n");
}

function ensureDailyRelationshipFile(filepath: string): void {
  if (fs.existsSync(filepath)) return;
  const date = getDateString();
  const header = `# Relationship Notes: ${date}\n\n*Auto-captured from sessions. Manual additions welcome.*\n\n---\n`;
  fs.writeFileSync(filepath, header, "utf-8");
}

export async function captureRelationshipMemory(sessionId: string): Promise<void> {
  try {
    if (!(isMemoryParityEnabled() && isEnvFlagEnabled("PAI_ENABLE_RELATIONSHIP_MEMORY", true))) {
      return;
    }

    const workPath = await getCurrentWorkPathForSession(sessionId);
    if (!workPath) return;

    const threadPath = path.join(workPath, "THREAD.md");
    if (!fs.existsSync(threadPath)) return;
    const thread = await fs.promises.readFile(threadPath, "utf-8");
    if (!thread.trim()) return;

    const blocks = parseThreadBlocks(thread);
    const users = blocks.filter((b) => b.role === "user").map((b) => b.text);
    const assistants = blocks.filter((b) => b.role === "assistant").map((b) => b.text);
    const notes = analyzeForRelationship(
      users,
      assistants,
      isEnvFlagEnabled("PAI_ENABLE_RELATIONSHIP_WORLD_NOTES", false),
    );
    if (notes.length === 0) return;

    // Dedup per-session based on note content.
    const statePath = path.join(workPath, "RELATIONSHIP_STATE.json");
    const currentKey = hashNotesKey(notes);
    try {
      if (fs.existsSync(statePath)) {
        const prev = JSON.parse(await fs.promises.readFile(statePath, 'utf-8')) as { lastKey?: string };
        if (prev?.lastKey && prev.lastKey === currentKey) return;
      }
    } catch {
      // ignore
    }

    const relDir = path.join(getMemoryDir(), "RELATIONSHIP", getYearMonth());
    await ensureDir(relDir);
    const daily = path.join(relDir, `${getDateString()}.md`);
    ensureDailyRelationshipFile(daily);

    const formatted = formatNotes(notes);
    if (!formatted) return;
    await fs.promises.appendFile(daily, formatted, "utf-8");

    fileLog(`RelationshipMemory wrote ${notes.length} notes`, "debug");

    await fs.promises.writeFile(
      statePath,
      JSON.stringify({ lastKey: currentKey, updatedAt: new Date().toISOString() }, null, 2)
    );
  } catch (error) {
    fileLogError("Relationship memory capture failed", error);
  }
}
