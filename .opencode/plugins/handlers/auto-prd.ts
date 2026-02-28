import * as fs from "node:fs";
import * as path from "node:path";

import { classifyPrompt, isTrivialPrompt, type PromptClassification } from "../lib/prompt-classification";
import { isEnvFlagEnabled, isMemoryParityEnabled } from "../lib/env-flags";
import { getCurrentWorkPathForSession, slugify } from "../lib/paths";
import { generatePRDFilename, generatePRDTemplate } from "../lib/prd-template";

const AUTO_PRD_FLAG = "PAI_ENABLE_AUTO_PRD";
const AUTO_PRD_CLASSIFICATION_FLAG = "PAI_ENABLE_AUTO_PRD_PROMPT_CLASSIFICATION";

type WorkMeta = {
  startedAt: Date;
  title: string;
};

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function parseMetaValue(content: string, key: string): string | null {
  const matcher = new RegExp(`^${key}:\\s*(.+)\\s*$`, "m");
  const match = content.match(matcher);
  if (!match?.[1]) return null;

  const raw = match[1].trim();
  if (!raw) return null;

  const quoted = raw.match(/^"([\s\S]*)"$/) || raw.match(/^'([\s\S]*)'$/);
  return quoted?.[1] ?? raw;
}

async function readMeta(workPath: string): Promise<WorkMeta | null> {
  const metaPath = path.join(workPath, "META.yaml");
  let content = "";

  try {
    content = await fs.promises.readFile(metaPath, "utf-8");
  } catch {
    return null;
  }

  const startedAtRaw = parseMetaValue(content, "started_at");
  const titleRaw = parseMetaValue(content, "title");
  if (!startedAtRaw || !titleRaw) return null;

  const startedAt = new Date(startedAtRaw);
  if (Number.isNaN(startedAt.getTime())) return null;

  const title = titleRaw.trim();
  if (!title) return null;

  return { startedAt, title };
}

async function writeFileAtomicOnce(filePath: string, content: string): Promise<boolean> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  let handle: fs.promises.FileHandle | null = null;

  try {
    handle = await fs.promises.open(filePath, "wx");
    await handle.writeFile(content, "utf-8");
    await handle.sync();
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") {
      return false;
    }
    throw error;
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

function toEffortLabel(effort: PromptClassification["effort"]): string {
  if (effort === "high") return "Thorough";
  if (effort === "low") return "Light";
  return "Standard";
}

async function writeClassificationArtifact(
  workPath: string,
  classification: PromptClassification,
): Promise<void> {
  const artifactPath = path.join(workPath, "PROMPT_CLASSIFICATION.json");
  const payload = {
    v: classification.v,
    ts: classification.ts,
    type: classification.type,
    title: classification.title,
    effort: classification.effort,
    is_new_topic: classification.is_new_topic,
    source: classification.source,
  };

  await writeFileAtomicOnce(artifactPath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function ensurePrdForSession(sessionId: string, prompt: string): Promise<void> {
  if (!isMemoryParityEnabled()) return;
  if (!isEnvFlagEnabled(AUTO_PRD_FLAG, true)) return;

  const workPath = await getCurrentWorkPathForSession(sessionId);
  if (!workPath) return;

  if (isTrivialPrompt(prompt)) return;

  const classification = classifyPrompt(prompt);

  const meta = await readMeta(workPath);
  if (!meta) return;

  const slug = slugify(meta.title) || "work-session";
  const prdPath = path.join(workPath, generatePRDFilename(slug, meta.startedAt));
  const prdContent = generatePRDTemplate({
    title: meta.title,
    slug,
    effortLevel: toEffortLabel(classification.effort),
    now: meta.startedAt,
  });

  await writeFileAtomicOnce(prdPath, prdContent);

  if (!isEnvFlagEnabled(AUTO_PRD_CLASSIFICATION_FLAG, true)) return;
  await writeClassificationArtifact(workPath, classification);
}
