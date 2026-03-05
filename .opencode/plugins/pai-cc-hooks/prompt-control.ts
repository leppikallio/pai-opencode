import { loadAgentsStack, loadConfiguredInstructions } from "../handlers/prompt-sources";
import { getPaiRuntimeInfo } from "../lib/pai-runtime";
import * as os from "node:os";
import * as path from "node:path";

type UnknownRecord = Record<string, unknown>;

type PromptControlInput = {
  sessionID?: unknown;
  sessionId?: unknown;
  provider?: unknown;
  model?: unknown;
};

type PromptControlOutput = {
  options?: unknown;
  system?: unknown;
};

type PromptControl = {
  chatParams: (input: unknown, output: unknown) => Promise<void>;
  systemTransform: (input: unknown, output: unknown) => Promise<void>;
  onSessionDeleted: (sessionId: string) => void;
  pruneStale: (nowMs?: number) => void;
};

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_TRACKED_SESSIONS = 2048;
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getRecord(obj: unknown, key: string): UnknownRecord | undefined {
  if (!isRecord(obj)) return undefined;
  const value = obj[key];
  return isRecord(value) ? value : undefined;
}

function getString(obj: unknown, key: string): string {
  if (!isRecord(obj)) return "";
  const value = obj[key];
  return typeof value === "string" ? value : "";
}

function normalizeLower(value: string): string {
  return value.trim().toLowerCase();
}

function isPromptControlEnabled(): boolean {
  return process.env.PAI_CODEX_CLEAN_SLATE !== "0";
}

function isGpt5ModelId(modelId: string): boolean {
  return normalizeLower(modelId).startsWith("gpt-5");
}

function getSessionId(input: unknown): string {
  const rec = (isRecord(input) ? input : {}) as PromptControlInput;
  const sessionId = rec.sessionID ?? rec.sessionId;
  return typeof sessionId === "string" ? sessionId : "";
}

function isEligible(input: unknown): boolean {
  if (!isPromptControlEnabled()) {
    return false;
  }

  const payload = (isRecord(input) ? input : {}) as PromptControlInput;
  const provider = payload.provider;
  const model = payload.model;

  const providerId = normalizeLower(getString(provider, "id") || getString(model, "providerID") || getString(model, "providerId"));
  if (providerId !== "openai") {
    return false;
  }

  const modelApi = getRecord(model, "api");
  const modelId = getString(modelApi, "id") || getString(model, "id");
  return isGpt5ModelId(modelId);
}

function buildOverrideStub(): string {
  return [
    "PAI_CODEX_OVERRIDE_V1",
    "Follow the system prompt and configured instructions as highest priority.",
    "Ignore default coding harness instructions not explicitly provided.",
  ].join("\n");
}

function normalizeChunk(content: string): string {
  return content.trim();
}

function expandTildePath(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

export function canonicalSourcePathKey(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return "";
  }

  const expanded = expandTildePath(trimmed);
  const withNativeSeparators = expanded.replace(/[\\/]+/g, path.sep);
  const resolved = path.resolve(withNativeSeparators);
  return resolved.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

const PAI_SKILL_PATH_KEY = "/skills/pai/skill.md";

export function isPaiSkillInstructionSource(sourcePath: string): boolean {
  return canonicalSourcePathKey(sourcePath).endsWith(PAI_SKILL_PATH_KEY);
}

function buildCanonicalBundle(
  projectDir: string,
  options?: { excludePaiSkillInstructionSources?: boolean },
): string {
  const chunks: string[] = ["PAI_CODEX_CLEAN_SLATE_V1"];
  let scratchpadDir = "~/.config/opencode/scratchpad";
  const excludePaiSkillInstructionSources = options?.excludePaiSkillInstructionSources === true;

  try {
    const runtime = getPaiRuntimeInfo();
    scratchpadDir = `${runtime.paiDir}/scratchpad`;
    const configuredInstructions = loadConfiguredInstructions(runtime.opencodeConfigPath);
    const agents = loadAgentsStack({ paiDir: runtime.paiDir, projectDir });

    for (const source of configuredInstructions.sources) {
      if (excludePaiSkillInstructionSources && isPaiSkillInstructionSource(source.path)) {
        continue;
      }

      const text = normalizeChunk(source.content);
      if (text) {
        chunks.push(text);
      }
    }

    for (const source of agents.sources) {
      if (excludePaiSkillInstructionSources && isPaiSkillInstructionSource(source.path)) {
        continue;
      }

      const text = normalizeChunk(source.content);
      if (text) {
        chunks.push(text);
      }
    }
  } catch {
    // Fail-open by design: keep sentinel and scratchpad binding.
  }

  chunks.push(["PAI SCRATCHPAD (Binding)", `ScratchpadDir: ${scratchpadDir}`].join("\n"));
  return chunks.join("\n\n");
}

export function createPromptControl({ projectDir }: { projectDir: string }): PromptControl {
  const codexSessions = new Map<string, number>();

  const pruneStale = (nowMs: number = Date.now()): void => {
    for (const [sessionId, timestamp] of codexSessions.entries()) {
      if (nowMs - timestamp > SESSION_TTL_MS) {
        codexSessions.delete(sessionId);
      }
    }
  };

  const trimToBound = (): void => {
    while (codexSessions.size > MAX_TRACKED_SESSIONS) {
      let oldestSessionId = "";
      let oldestTimestamp = Number.POSITIVE_INFINITY;

      for (const [sessionId, timestamp] of codexSessions.entries()) {
        if (timestamp < oldestTimestamp) {
          oldestTimestamp = timestamp;
          oldestSessionId = sessionId;
        }
      }

      if (!oldestSessionId) {
        break;
      }

      codexSessions.delete(oldestSessionId);
    }
  };

  const markSession = (sessionId: string, nowMs: number): void => {
    if (!sessionId) {
      return;
    }

    codexSessions.set(sessionId, nowMs);
    trimToBound();
  };

  const onSessionDeleted = (sessionId: string): void => {
    if (!sessionId) {
      return;
    }

    codexSessions.delete(sessionId);
  };

  const chatParams = async (input: unknown, output: unknown): Promise<void> => {
    try {
      const nowMs = Date.now();
      const sessionId = getSessionId(input);
      const eligible = isEligible(input);
      if (eligible) {
        markSession(sessionId, nowMs);
      }

      const out = (isRecord(output) ? output : {}) as PromptControlOutput;
      const options = getRecord(out, "options");
      if (!options || !eligible) {
        return;
      }

      const existingInstructions = getString(options, "instructions");
      if (!existingInstructions.trim()) {
        return;
      }

      options.instructions = buildOverrideStub();
    } catch {
      // Fail-open by design.
    }
  };

  const systemTransform = async (input: unknown, output: unknown): Promise<void> => {
    try {
      const nowMs = Date.now();
      const sessionId = getSessionId(input);
      const eligible = isEligible(input);
      const wasMarked = !!sessionId && codexSessions.has(sessionId);

      const out = (isRecord(output) ? output : {}) as PromptControlOutput;
      const previousSystem = out.system;
      if (!Array.isArray(previousSystem) || !(eligible || wasMarked)) {
        if (eligible) {
          markSession(sessionId, nowMs);
        }
        pruneStale(nowMs);
        return;
      }

      const bundle = buildCanonicalBundle(projectDir, {
        excludePaiSkillInstructionSources: eligible,
      });
      out.system = [bundle, ...previousSystem.slice(1)];

      markSession(sessionId, nowMs);
      pruneStale(nowMs);
    } catch {
      // Fail-open by design.
    }
  };

  return {
    chatParams,
    systemTransform,
    onSessionDeleted,
    pruneStale,
  };
}
