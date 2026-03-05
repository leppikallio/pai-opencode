import { loadAgentsStack, loadConfiguredInstructions } from "../handlers/prompt-sources";
import {
  ensureDir,
  generateSessionId,
  getCurrentWorkPathForSession,
} from "../lib/paths";
import { getPaiRuntimeInfo } from "../lib/pai-runtime";
import { ensureScratchpadSession } from "../lib/scratchpad";
import * as os from "node:os";
import * as path from "node:path";
import { getSessionRootId } from "./shared/session-root";

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
const SAFE_FALLBACK_SESSION_ID_PREFIX = "session_unknown_";
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

function normalizeSessionId(sessionIdRaw: string): string {
  const trimmed = sessionIdRaw.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.replace(/[^A-Za-z0-9_-]/g, "");
}

function createSyntheticRootSessionId(): string {
  return `${SAFE_FALLBACK_SESSION_ID_PREFIX}${generateSessionId()}`;
}

function getResolvedRootSessionId(sessionIdRaw: string): string {
  const sessionId = normalizeSessionId(sessionIdRaw);
  if (!sessionId) {
    return "";
  }

  const mappedRootSessionId = normalizeSessionId(getSessionRootId(sessionId) ?? "");
  return mappedRootSessionId || sessionId;
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
  scratchpadDir: string,
  options?: { excludePaiSkillInstructionSources?: boolean },
): string {
  const chunks: string[] = ["PAI_CODEX_CLEAN_SLATE_V1"];
  const excludePaiSkillInstructionSources = options?.excludePaiSkillInstructionSources === true;

  try {
    const runtime = getPaiRuntimeInfo();
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
  const scratchpadByRoot = new Map<string, string>();
  const scratchpadBySession = new Map<string, string>();
  const rootBySession = new Map<string, string>();
  const scratchpadTouchedAt = new Map<string, number>();

  const trimScratchpadToBound = (): void => {
    while (scratchpadTouchedAt.size > MAX_TRACKED_SESSIONS) {
      let oldestSessionId = "";
      let oldestTimestamp = Number.POSITIVE_INFINITY;
      for (const [sessionId, timestamp] of scratchpadTouchedAt.entries()) {
        if (timestamp < oldestTimestamp) {
          oldestTimestamp = timestamp;
          oldestSessionId = sessionId;
        }
      }

      if (!oldestSessionId) {
        break;
      }

      scratchpadTouchedAt.delete(oldestSessionId);
      scratchpadBySession.delete(oldestSessionId);
      rootBySession.delete(oldestSessionId);
    }
  };

  const pruneRootCache = (): void => {
    const activeRoots = new Set<string>();
    for (const rootSessionId of rootBySession.values()) {
      activeRoots.add(rootSessionId);
    }

    for (const rootSessionId of scratchpadByRoot.keys()) {
      if (!activeRoots.has(rootSessionId)) {
        scratchpadByRoot.delete(rootSessionId);
      }
    }
  };

  const pruneStale = (nowMs: number = Date.now()): void => {
    for (const [sessionId, timestamp] of codexSessions.entries()) {
      if (nowMs - timestamp > SESSION_TTL_MS) {
        codexSessions.delete(sessionId);
      }
    }

    for (const [sessionId, timestamp] of scratchpadTouchedAt.entries()) {
      if (nowMs - timestamp > SESSION_TTL_MS) {
        scratchpadTouchedAt.delete(sessionId);
        scratchpadBySession.delete(sessionId);
        rootBySession.delete(sessionId);
      }
    }

    pruneRootCache();
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
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    codexSessions.set(normalizedSessionId, nowMs);
    trimToBound();
  };

  const markScratchpadSession = (args: {
    sessionId: string;
    rootSessionId: string;
    scratchpadDir: string;
    nowMs: number;
  }): void => {
    const normalizedSessionId = normalizeSessionId(args.sessionId);
    if (!normalizedSessionId) {
      return;
    }

    scratchpadBySession.set(normalizedSessionId, args.scratchpadDir);
	rootBySession.set(normalizedSessionId, args.rootSessionId);
	scratchpadTouchedAt.set(normalizedSessionId, args.nowMs);
	trimScratchpadToBound();
  };

  const resolveScratchpadDirForRoot = async (rootSessionId: string): Promise<string> => {
    const workDir = await getCurrentWorkPathForSession(rootSessionId);
    if (workDir) {
      const scratchDir = path.join(workDir, "scratch", rootSessionId);
      await ensureDir(scratchDir);
      return scratchDir;
    }

    const scratchpad = await ensureScratchpadSession(rootSessionId);
    return scratchpad.dir;
  };

	const resolvePinnedScratchpadDir = async (args: {
		sessionId: string;
		nowMs: number;
	}): Promise<string> => {
		const normalizedSessionId = normalizeSessionId(args.sessionId);
		if (!normalizedSessionId) {
			// D1 Option A: missing/empty session ids must never co-mingle.
			// Use a unique synthetic root id per call and bypass all caches.
			const scratchpad = await ensureScratchpadSession(
				createSyntheticRootSessionId(),
			);
			return scratchpad.dir;
		}

    if (normalizedSessionId) {
      const existingSessionScratchpad = scratchpadBySession.get(normalizedSessionId);
      if (existingSessionScratchpad) {
        scratchpadTouchedAt.set(normalizedSessionId, args.nowMs);
        return existingSessionScratchpad;
      }
    }

    const rootSessionId = getResolvedRootSessionId(args.sessionId);
    const existingRootScratchpad = scratchpadByRoot.get(rootSessionId);
    if (existingRootScratchpad) {
      markScratchpadSession({
        sessionId: args.sessionId,
        rootSessionId,
        scratchpadDir: existingRootScratchpad,
        nowMs: args.nowMs,
      });
      return existingRootScratchpad;
    }

    const scratchpadDir = await resolveScratchpadDirForRoot(rootSessionId);
    scratchpadByRoot.set(rootSessionId, scratchpadDir);
    markScratchpadSession({
      sessionId: args.sessionId,
      rootSessionId,
      scratchpadDir,
      nowMs: args.nowMs,
    });
    return scratchpadDir;
  };

  const onSessionDeleted = (sessionId: string): void => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    codexSessions.delete(normalizedSessionId);
    scratchpadBySession.delete(normalizedSessionId);
    scratchpadTouchedAt.delete(normalizedSessionId);
    rootBySession.delete(normalizedSessionId);
    pruneRootCache();
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
      const normalizedSessionId = normalizeSessionId(sessionId);
      const wasMarked = !!normalizedSessionId && codexSessions.has(normalizedSessionId);

      const out = (isRecord(output) ? output : {}) as PromptControlOutput;
      const previousSystem = out.system;
      if (!Array.isArray(previousSystem) || !(eligible || wasMarked)) {
        if (eligible) {
          markSession(sessionId, nowMs);
        }
        pruneStale(nowMs);
        return;
      }

      const scratchpadDir = await resolvePinnedScratchpadDir({
        sessionId,
        nowMs,
      });

      const bundle = buildCanonicalBundle(projectDir, scratchpadDir, {
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
