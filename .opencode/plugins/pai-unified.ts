/**
 * PAI-OpenCode Unified Plugin
 *
 * Single plugin that combines all PAI v2.4 hook functionality:
 * - Context injection (SessionStart equivalent)
 * - Security validation (PreToolUse blocking equivalent)
 * - Work tracking (AutoWorkCreation + SessionSummary)
 * - Rating capture (ExplicitRatingCapture)
 * - Agent output capture (AgentOutputCapture)
 * - Learning extraction (WorkCompletionLearning)
 *
 * IMPORTANT: This plugin NEVER uses console.log!
 * All logging goes through file-logger.ts to prevent TUI corruption.
 *
 * @module pai-unified
 * @version 1.0.0
 */

import { tool, type Plugin, type Hooks } from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadContext } from "./handlers/context-loader";
import { validateSecurity } from "./handlers/security-validator";
import { restoreSkillFiles } from "./handlers/skill-restore";
import { captureRating } from "./handlers/rating-capture";
import {
  captureAgentOutput,
  isTaskTool,
} from "./handlers/agent-capture";
import { createHistoryCapture } from "./handlers/history-capture";
import { runImplicitSentimentSelftest } from "./handlers/sentiment-capture";
import {
  buildFallbackFullWrapper,
  buildFallbackMinimalWrapper,
  detectEnforcementMode,
  looksLikeJsonOnly,
  validateOutput,
  type EnforcementMode,
} from "./handlers/enforcement-gate";
import { loadAgentsStack, loadConfiguredInstructions } from "./handlers/prompt-sources";
import { fileLog, fileLogError, clearLog } from "./lib/file-logger";
import { getVoiceId } from "./lib/identity";
import { getSessionStatusType } from "./lib/event-normalize";
import {
  ensureDir,
  getStateDir,
  getCurrentWorkPathForSession,
} from "./lib/paths";
import {
  ensureScratchpadSession,
} from "./lib/scratchpad";
import { createWorkSession } from "./handlers/work-tracker";
import { getPaiRuntimeInfo } from "./lib/pai-runtime";
import {
  isKittyTabsEnabled,
  setKittyTabState,
  type KittyTabState,
} from "./handlers/kitty-tabs";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getProp(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  return obj[key];
}

function getStringProp(obj: unknown, key: string): string | undefined {
  const v = getProp(obj, key);
  return typeof v === "string" ? v : undefined;
}

function getRecordProp(obj: unknown, key: string): UnknownRecord | undefined {
  const v = getProp(obj, key);
  return isRecord(v) ? v : undefined;
}

type ToastVariant = "info" | "success" | "warning" | "error";

type RatingKioskMode = "idle" | "armed" | "pendingTen" | "pendingConfirm";

interface RatingKioskState {
  mode: RatingKioskMode;
  armedAt: number;
  armedUntil: number;
  pendingTenUntil: number;
  typedSinceArm: string;
  promptSnapshot: string;
  lastCapturedAt: number;
  lastArmedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  pendingTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * PAI Unified Plugin
 *
 * Exports all hooks in a single plugin for OpenCode.
 * Implements PAI v2.4 hook functionality.
 */
export const PaiUnified: Plugin = async (ctx) => {
  const client = getProp(ctx, "client");
  const directory = typeof (ctx as unknown as { directory?: unknown }).directory === "string"
    ? ((ctx as unknown as { directory?: string }).directory as string)
    : "";

  // Debug mode: enables extra evidence files and optional toasts.
  const PAI_DEBUG = process.env.PAI_DEBUG === "1";

  // Selftests and toasts are disabled. Enforcement must be silent.
  const ENABLE_FORMAT_GATE_SELFTEST = false;
  const ENABLE_IMPLICIT_SENTIMENT_SELFTEST = false;
  const ENABLE_PROMPT_HINT_TOASTS = false;
  const ENABLE_FORMAT_HINT_TOASTS = false;

  // Enforcement gate is always enabled for primary sessions.
  const ENABLE_FORMAT_GATE = true;
  // Debug-only: write per-session FORMAT_GATE.jsonl evidence.
  const FORMAT_GATE_WRITE_EVIDENCE = PAI_DEBUG;
  // Guardrails: rate limit Task subagent spawns per session.
  const TASK_RATE_LIMIT_WINDOW_MS = Number(process.env.PAI_TASK_RATE_LIMIT_WINDOW_MS || "120000");
  const TASK_RATE_LIMIT_MAX = Number(process.env.PAI_TASK_RATE_LIMIT_MAX || "30");
  const TASK_RATE_LIMIT_ALGO_MAX = Number(process.env.PAI_TASK_RATE_LIMIT_ALGO_MAX || "8");
  const TASK_RATE_LIMIT_DISABLE = process.env.PAI_TASK_RATE_LIMIT_DISABLE === "1";

  const internalCarrierSessions = new Set<string>();
  const rewriteInflightByKey = new Map<
    string,
    Promise<{ ok: true; text: string } | { ok: false; error: string }>
  >();
  const lastUserTextBySession = new Map<string, string>();
  const sawToolCallThisTurn = new Map<string, boolean>();

  // Optional Kitty tab state (opt-in)
  const kittyTabStateBySession = new Map<string, KittyTabState>();
  const kittyTabSeedBySession = new Map<string, string>();
  const rewriteAttemptedByPart = new Set<string>();
  const codexOverrideSessions = new Set<string>();
  const sessionParentById = new Map<string, string | null>();
  const taskRateBySession = new Map<
    string,
    {
      windowStart: number;
      total: number;
      algorithm: number;
    }
  >();

  type SessionKind = "primary" | "subagent" | "internal" | "unknown";

  function classifySessionKind(sessionId: string | null | undefined): SessionKind {
    if (!sessionId) return "unknown";
    if (internalCarrierSessions.has(sessionId)) return "internal";
    const parent = sessionParentById.get(sessionId);
    if (parent === undefined) return "unknown";
    return parent ? "subagent" : "primary";
  }

  function storageSessionIdFor(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null;
    const parent = sessionParentById.get(sessionId);
    if (parent) return parent;
    return sessionId;
  }

  async function ensureSessionParentCached(sessionId: string): Promise<void> {
    if (sessionParentById.has(sessionId)) return;
    try {
      const sessionApi = (carrierClient as unknown as { session?: UnknownRecord }).session as UnknownRecord | undefined;
      const getFn = sessionApi ? (sessionApi.get as unknown) : undefined;
      if (typeof getFn !== "function") return;

      const call = async (args: UnknownRecord) =>
        await (getFn as (this: unknown, args: UnknownRecord) => Promise<unknown>).call(sessionApi, args);

      // Try SDK v1 style: { path: { id } }
      let res: unknown;
      try {
        res = await call({
          path: { id: sessionId },
          ...(directory ? { query: { directory } } : {}),
        });
      } catch {
        // Try SDK v2 style: { path: { sessionID } }
        res = await call({
          path: { sessionID: sessionId },
          ...(directory ? { query: { directory } } : {}),
        });
      }

      const data = getRecordProp(res, "data");
      const parentID = getStringProp(data, "parentID");
      sessionParentById.set(sessionId, parentID ? parentID : null);
    } catch {
      // Best-effort only.
    }
  }

  function isPrimarySession(sessionId: string | null | undefined): boolean {
    return classifySessionKind(sessionId) === "primary";
  }

  function isSubagentLikeSession(sessionId: string | null | undefined): boolean {
    const kind = classifySessionKind(sessionId);
    return kind === "subagent" || kind === "unknown";
  }

  function cacheSessionInfoFromEvent(eventObj: UnknownRecord | undefined) {
    if (!eventObj) return;
    const props = getRecordProp(eventObj, "properties");
    const info = props ? getRecordProp(props, "info") : undefined;
    const id = getStringProp(info, "id");
    if (!id) return;
    const parentID = getStringProp(info, "parentID");

    // Treat all internal helper sessions as internal.
    // These are created by carrier-based classifiers (PromptHint/ImplicitSentiment/FormatGate).
    const title = getStringProp(info, "title") ?? "";
    if (title.startsWith("[PAI INTERNAL]")) {
      internalCarrierSessions.add(id);
    }

    sessionParentById.set(id, parentID ? parentID : null);
  }

  function isOpenAIProviderId(providerId: string): boolean {
    return providerId.toLowerCase() === "openai";
  }

  function isGpt5ModelId(modelId: string): boolean {
    const id = modelId.trim().toLowerCase();
    return id.startsWith("gpt-5");
  }

  function getProviderIdFromModel(modelObj: unknown): string {
    return getStringProp(modelObj, "providerID") ?? getStringProp(modelObj, "providerId") ?? "";
  }

  function getModelApiId(modelObj: unknown): string {
    const api = getProp(modelObj, "api");
    const apiId = getStringProp(api, "id") ?? "";
    const id = getStringProp(modelObj, "id") ?? "";
    return apiId || id;
  }

  function getProviderIdFromProvider(providerObj: unknown): string {
    return getStringProp(providerObj, "id") ?? "";
  }

  function isCodexOverrideSession(sessionId: string): boolean {
    return codexOverrideSessions.has(sessionId);
  }

  function buildCanonicalSystemBundle(opts: {
    scratchpadDir: string;
    projectDir: string;
    includeSubagentDirective: boolean;
  }): string[] {
    const runtime = getPaiRuntimeInfo();

    const ins = loadConfiguredInstructions(runtime.opencodeConfigPath);
    const agents = loadAgentsStack({ paiDir: runtime.paiDir, projectDir: opts.projectDir });

    const chunks: string[] = [];

    // Sentinel for verification.
    chunks.push("PAI_CODEX_CLEAN_SLATE_V1");

    // opencode.json instructions[] (filesystem files)
    for (const src of ins.sources) {
      if (!src.content) continue;
      chunks.push(src.content);
    }

    // Nested AGENTS.md stack
    for (const src of agents.sources) {
      if (!src.content) continue;
      chunks.push(src.content);
    }

    // Binding scratchpad directive with per-session path.
    chunks.push(
      [
        "PAI SCRATCHPAD (Binding)",
        `ScratchpadDir: ${opts.scratchpadDir}`,
        "Rules:",
        "- Write ALL temporary artifacts under ScratchpadDir.",
        "- Do NOT write drafts/reviews into the current working directory.",
        "- Only write outside ScratchpadDir when explicitly instructed with an exact destination path.",
      ].join("\n")
    );

    if (opts.includeSubagentDirective) {
      chunks.push(
        [
          "PAI SUBAGENT MODE (Binding)",
          "- Return findings only; be concise and specific.",
          "- Do NOT ask for ratings, sentiment, or feedback.",
          "- Do NOT run format gating or self-correction loops.",
        ].join("\n")
      );
    }

    // Ensure system[] is non-empty.
    return [chunks.filter((c) => c.trim()).join("\n\n")].filter((x) => x.trim());
  }

  // Clear log at plugin load (new session)
  clearLog();
  fileLog("=== PAI-OpenCode Plugin v1.0.0 Loaded ===");
  fileLog(`Working directory: ${process.cwd()}`);
  fileLog("Hooks: Context, Security, Work, Ratings, Agents, Learning");

  // === RATING KIOSK MODE ===
  // Fast, optional rating capture:
  // - Press 2-9 to log instantly
  // - Press 1 then 0 (within 600ms) to log 10
  // - Press 1 alone to log 1 (after timeout)
  // - Any other key = skip (no logging)
  // This is implemented via TUI events (not a custom tool).
  // NOTE: If this feels too "flashy" in the TUI, increase ARM window.
  // We also try to pass a toast duration, but older OpenCode builds may ignore it.
  const RATING_ARM_WINDOW_MS = 6000;
  const RATING_PENDING_TEN_MS = 900;
  const RATING_CONFIRM_SINGLE_MS = 250;
  const RATING_ARM_COOLDOWN_MS = 2500;

  const ratingKiosk: RatingKioskState = {
    mode: "idle",
    armedAt: 0,
    armedUntil: 0,
    pendingTenUntil: 0,
    typedSinceArm: "",
    promptSnapshot: "",
    lastCapturedAt: 0,
    lastArmedAt: 0,
    timer: null,
    pendingTimer: null,
  };

  // If the user is actively typing, don't pop the rating kiosk.
  let lastPromptAppendAt = 0;
  let lastKioskPromptLogAt = 0;

  // (capability audit logging removed)

  const serverUrlValue = getProp(ctx, "serverUrl");
  const serverUrl =
    serverUrlValue instanceof URL
      ? serverUrlValue.toString()
      : typeof serverUrlValue === "string"
        ? serverUrlValue
        : "http://localhost:4096";
  const carrierClient = client as unknown as {
    session?: {
      create?: (options?: unknown) => Promise<unknown>;
      prompt?: (options: unknown) => Promise<unknown>;
      delete?: (options: unknown) => Promise<unknown>;
    };
  };

  const historyCapture = createHistoryCapture({
    serverUrl,
    client: carrierClient,
    directory,
  });

  async function writeFormatGateSelftest(record: Record<string, unknown>) {
    try {
      const stateDir = getStateDir();
      await ensureDir(stateDir);
      const filePath = path.join(stateDir, "format-gate-selftest.json");
      await fs.promises.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
    } catch (error) {
      fileLogError("Format gate selftest write failed", error);
    }
  }

  async function writeImplicitSentimentSelftest(record: Record<string, unknown>) {
    try {
      const stateDir = getStateDir();
      await ensureDir(stateDir);
      const filePath = path.join(stateDir, "implicit-sentiment-selftest.json");
      await fs.promises.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
    } catch (error) {
      fileLogError("Implicit sentiment selftest write failed", error);
    }
  }

  // One-shot format hint toast per idle transition.
  const formatHintTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const promptHintTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function expandTilde(p: string): string {
    if (p === "~") return os.homedir();
    if (p.startsWith("~/") || p.startsWith("~\\")) {
      return path.join(os.homedir(), p.slice(2));
    }
    return p;
  }

  function normalizeArgsTilde(value: unknown): unknown {
    if (typeof value === "string") {
      // Only expand leading tilde paths. This fixes failures like:
      //   ~/.config/opencode/... -> /Users/<user>/.config/opencode/...
      return expandTilde(value);
    }
    if (Array.isArray(value)) {
      return value.map((v) => normalizeArgsTilde(v));
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        obj[k] = normalizeArgsTilde(obj[k]);
      }
      return obj;
    }
    return value;
  }

  async function showToast(
    message: string,
    variant: ToastVariant = "info",
    durationMs?: number
  ) {
    try {
      const tui = getRecordProp(client, "tui");
      const showToastFn = tui ? (tui as unknown as { showToast?: unknown }).showToast : undefined;
      if (typeof showToastFn !== "function") return;
      // duration is not documented in all builds; pass through best-effort.
      const body: UnknownRecord = {
        message,
        variant,
        ...(typeof durationMs === "number" ? { duration: durationMs } : {}),
      };
      // NOTE: call with the tui context (SDK methods expect `this`).
      await (showToastFn as (this: unknown, args: { body: UnknownRecord }) => Promise<unknown>).call(
        tui,
        { body }
      );
    } catch (error) {
      fileLogError("Toast failed", error);
    }
  }

  // === FAIL-OPEN NOTICES (History capture) ===
  // If capture stalls, we want:
  // - detailed evidence in debug.log (when PAI_DEBUG=1)
  // - optional real-time toast so you immediately notice capture degradation
  const ENABLE_HISTORY_CAPTURE_TOASTS =
    PAI_DEBUG || (process.env.PAI_HISTORY_CAPTURE_TOASTS ?? "").trim() === "1";
  const HISTORY_CAPTURE_TOOL_TIMEOUT_MS = (() => {
    const raw = (process.env.PAI_HISTORY_CAPTURE_TOOL_TIMEOUT_MS ?? "").trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 350;
  })();
  const HISTORY_CAPTURE_EVENT_TIMEOUT_MS = (() => {
    const raw = (process.env.PAI_HISTORY_CAPTURE_EVENT_TIMEOUT_MS ?? "").trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 1200;
  })();

  const lastHistoryCaptureToastAtBySession = new Map<string, number>();
  function maybeToastHistoryCaptureIssue(sessionId: string | undefined, message: string) {
    if (!ENABLE_HISTORY_CAPTURE_TOASTS) return;
    if (!sessionId) return;
    const now = Date.now();
    const last = lastHistoryCaptureToastAtBySession.get(sessionId) ?? 0;
    // Rate limit to avoid toast spam during event storms.
    if (now - last < 8000) return;
    lastHistoryCaptureToastAtBySession.set(sessionId, now);
    void showToast(message, "warning", 4500);
  }

  async function withWallClockTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string
  ): Promise<{ ok: true; value: T } | { ok: false; timeout: true; label: string; timeoutMs: number }> {
    if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
      return { ok: true, value: await promise };
    }
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const raced = await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`timeout:${label}:${timeoutMs}`)), timeoutMs);
        }),
      ]);
      return { ok: true, value: raced };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.startsWith(`timeout:${label}:`)) {
        return { ok: false, timeout: true, label, timeoutMs };
      }
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function bestEffortHistoryCapture<T>(opts: {
    sessionId?: string;
    label: string;
    timeoutMs: number;
    run: () => Promise<T>;
  }): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    const startedAt = Date.now();
    try {
      const res = await withWallClockTimeout(opts.run(), opts.timeoutMs, opts.label);
      if (!res.ok) {
        const ms = Date.now() - startedAt;
        fileLog(
          `HistoryCapture fail-open: timeout label=${opts.label} waited=${ms}ms timeout=${res.timeoutMs}ms`,
          "warn"
        );
        maybeToastHistoryCaptureIssue(opts.sessionId, `History capture timeout (${opts.label})`);
        return { ok: false, reason: `timeout (${res.timeoutMs}ms)` };
      }
      return { ok: true, value: res.value };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      fileLogError(`HistoryCapture fail-open: error label=${opts.label}`, error);
      maybeToastHistoryCaptureIssue(opts.sessionId, `History capture error (${opts.label})`);
      return { ok: false, reason: `error (${msg})` };
    }
  }

  function extractTextFromParts(parts: unknown): string {
    const arr = Array.isArray(parts) ? parts : [];
    return arr
      .filter((p) => p && typeof p === "object" && (p as UnknownRecord).type === "text")
      .map((p) => ((p as UnknownRecord).text as string) || "")
      .join("")
      .trim();
  }

  async function appendFormatGateEvidence(sessionId: string, record: Record<string, unknown>) {
    if (!FORMAT_GATE_WRITE_EVIDENCE) return;
    try {
      const workPath = await getCurrentWorkPathForSession(sessionId);
      if (!workPath) return;
      const filePath = path.join(workPath, "FORMAT_GATE.jsonl");
      const line = `${JSON.stringify({ ts: new Date().toISOString(), sessionId, ...record })}\n`;
      await fs.promises.appendFile(filePath, line, "utf-8");
    } catch (error) {
      fileLogError("Format gate evidence write failed", error);
    }
  }


  // Validation and fallback wrappers live in handlers/enforcement-gate.ts

  async function rewriteToFormat(opts: {
    mode: "MINIMAL" | "FULL";
    userText: string;
    assistantText: string;
  }): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    const sessionApi = carrierClient.session;
    if (typeof sessionApi?.create !== "function" || typeof sessionApi?.prompt !== "function" || typeof sessionApi?.delete !== "function") {
      // As a fallback, avoid attempting a network call here.
      return { ok: false, error: "carrier client session api unavailable" };
    }

    function extractError(result: unknown): string | null {
      const error = getRecordProp(result, "error");
      if (error) {
        const msg = getStringProp(error, "message") || getStringProp(error, "error");
        if (msg) return msg;
        try {
          return `sdk error: ${JSON.stringify(error).slice(0, 400)}`;
        } catch {
          return "sdk error";
        }
      }
      const response = getRecordProp(result, "response");
      const status = response ? (response.status as unknown) : undefined;
      if (typeof status === "number" && status >= 400) {
        return `http ${status}`;
      }
      return null;
    }

    const createRes = await sessionApi.create({
      query: directory ? { directory } : undefined,
      body: {
        title: "[PAI INTERNAL] FormatGate",
        permission: [{ permission: "*", pattern: "*", action: "deny" }],
      },
    });

    const createErr = extractError(createRes);
    if (createErr) {
      return { ok: false, error: `carrier session create failed: ${createErr}` };
    }

    const sid = getStringProp(getRecordProp(createRes, "data"), "id");
    if (!sid) return { ok: false, error: "carrier session create returned no id" };
    internalCarrierSessions.add(sid);
    try {
      // Ensure internal sessions never get captured into workdirs.
      try {
        (historyCapture as unknown as { ignoreSession?: (sid: string) => void }).ignoreSession?.(sid);
      } catch {
        // ignore
      }

      const systemPrompt =
        opts.mode === "MINIMAL"
          ? [
              "You rewrite assistant output into the required minimal response format.",
              "Output MUST be exactly three lines:",
              "1) 🤖 PAI ALGORITHM ═════════════",
              "2) 📋 SUMMARY: <one sentence>",
              "3) 🗣️ Marvin: <max 16 words, factual>",
              "Do not add any other lines.",
              "Do not mention rewriting.",
            ].join("\n")
          : [
              "You rewrite assistant output into the required PAI FULL algorithm format (upstream v2.5 style).",
              "Requirements:",
              "- FIRST output token must be 🤖.",
              "- Include a header line: 🤖 Entering the PAI ALGORITHM...",
              "- Include all 7 phases with upstream headings:",
              "  ━━━ 👁️ OBSERVE ━━━ 1/7",
              "  ━━━ 🧠 THINK ━━━ 2/7",
              "  ━━━ 📋 PLAN ━━━ 3/7",
              "  ━━━ 🔨 BUILD ━━━ 4/7",
              "  ━━━ ⚡ EXECUTE ━━━ 5/7",
              "  ━━━ ✅ VERIFY ━━━ 6/7",
              "  ━━━ 📚 LEARN ━━━ 7/7",
              "- Include an 'ISC Tasks:' section (no manual ISC tables required).",
              "- Must include a 🗣️ Marvin: voice line (max 16 words).",
              "- Must NOT include ⭐ RATE prompts.",
              "- Preserve original meaning; do not invent tool results.",
              "- No meta commentary, no apologies.",
            ].join("\n");

      const userPrompt = [
        "USER_MESSAGE:",
        opts.userText || "(unknown)",
        "",
        "ASSISTANT_OUTPUT_TO_REWRITE:",
        opts.assistantText,
      ].join("\n");

      const promptRes = await sessionApi.prompt({
        path: { id: sid },
        query: directory ? { directory } : undefined,
        body: {
          model: { providerID: "openai", modelID: "gpt-5.2" },
          noReply: false,
          variant: "minimal",
          system: systemPrompt,
          parts: [{ type: "text", text: userPrompt }],
          tools: {},
        },
      });

      const promptErr = extractError(promptRes);
      if (promptErr) {
        return { ok: false, error: `carrier prompt failed: ${promptErr}` };
      }

      const data = getRecordProp(promptRes, "data");
      const out = extractTextFromParts(data ? (data as UnknownRecord).parts : undefined);
      if (!out) return { ok: false, error: "carrier returned empty output" };
      return { ok: true, text: out };
    } catch {
      return { ok: false, error: "carrier threw unexpected error" };
    } finally {
      try {
        await sessionApi.delete({
          path: { id: sid },
          query: directory ? { directory } : undefined,
        });
      } catch {
        // ignore
      } finally {
        internalCarrierSessions.delete(sid);
      }
      try {
        (historyCapture as unknown as { unignoreSession?: (sid: string) => void }).unignoreSession?.(sid);
      } catch {
        // ignore
      }
    }
  }

  async function runFormatGateSelftest() {
    const startedAt = new Date().toISOString();
    const minimalInput = {
      mode: "MINIMAL" as const,
      userText: "(selftest)",
      assistantText: "hello world",
    };
    const fullInput = {
      mode: "FULL" as const,
      userText: "(selftest)",
      assistantText: "just some unformatted output",
    };

    const fullMissingCriteria = [
      "🤖 PAI ALGORITHM ══════════════════════════════════════════════════════════════",
      "   Task: Selftest missing ISC criteria",
      "",
      "━━━ 👁️  O B S E R V E ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1/7",
      "",
      "**Observations:**",
      "- What exists now: test",
      "",
      "━━━ 📋  P L A N ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 3/7",
      "",
      "🎯 ISC TRACKER ════════════════════════════════════════════════════════════════",
      "│ # │ Criterion (exactly 8 word)              │ Status          │ Δ      │",
      "├───┼─────────────────────────────────────────┼─────────────────┼────────┤",
      "└───┴─────────────────────────────────────────┴─────────────────┴────────┘",
      "",
      "━━━ 📚  L E A R N ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 7/7",
      "",
      "📋 SUMMARY: selftest",
      "",
      "🗣️ Marvin: selftest",
    ].join("\n");

    const minimal = await rewriteToFormat(minimalInput);
    const full = await rewriteToFormat(fullInput);
    const missingCriteriaCheck = validateOutput(fullMissingCriteria, "FULL");

    await writeFormatGateSelftest({
      ts: startedAt,
      ok: {
        minimal: minimal.ok,
        full: full.ok,
      },
      validated: {
        minimal: minimal.ok ? validateOutput(minimal.text, "MINIMAL").ok : false,
        full: full.ok ? validateOutput(full.text, "FULL").ok : false,
      },
      iscGate: {
        missingCriteriaOk: missingCriteriaCheck.ok,
        missingCriteriaReasons: missingCriteriaCheck.reasons,
        missingCriteriaCount: missingCriteriaCheck.criteriaCount ?? 0,
      },
      error: {
        minimal: minimal.ok ? null : minimal.error,
        full: full.ok ? null : full.error,
      },
    });
  }

  function scheduleFormatHintToast(sessionId: string) {
    const existing = formatHintTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    // Wait for history-capture's COMMIT_DEBOUNCE_MS to run.
    const t = setTimeout(() => {
      formatHintTimers.delete(sessionId);
      try {
        // consumeFormatHint is best-effort; no hint means no toast.
        const hint = (historyCapture as unknown as { consumeFormatHint?: (sid: string) => unknown }).consumeFormatHint?.(sessionId);
        const rec = hint as UnknownRecord | undefined;
        const toastRec = rec ? (rec.toast as UnknownRecord | undefined) : undefined;
        const message = toastRec ? (toastRec.message as unknown) : undefined;
        const variant = toastRec ? (toastRec.variant as unknown) : undefined;
        const durationMs = toastRec ? (toastRec.durationMs as unknown) : undefined;

        if (typeof message === 'string' && message.trim()) {
          void showToast(
            message,
            (variant === 'warning' || variant === 'error' || variant === 'success' || variant === 'info'
              ? (variant as ToastVariant)
              : 'info'),
            typeof durationMs === 'number' ? durationMs : undefined
          );
        }
      } catch (error) {
        fileLogError('Format hint toast failed', error);
      }
    }, 450);

    formatHintTimers.set(sessionId, t);
  }

  function schedulePromptHintToast(sessionId: string) {
    const existing = promptHintTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const t = setTimeout(() => {
      promptHintTimers.delete(sessionId);
      try {
        const hint = (historyCapture as unknown as { consumePromptHint?: (sid: string) => unknown }).consumePromptHint?.(sessionId);
        const rec = hint as UnknownRecord | undefined;
        const toastRec = rec ? (rec.toast as UnknownRecord | undefined) : undefined;
        const message = toastRec ? (toastRec.message as unknown) : undefined;
        const variant = toastRec ? (toastRec.variant as unknown) : undefined;
        const durationMs = toastRec ? (toastRec.durationMs as unknown) : undefined;

        if (typeof message === 'string' && message.trim()) {
          void showToast(
            message,
            (variant === 'warning' || variant === 'error' || variant === 'success' || variant === 'info'
              ? (variant as ToastVariant)
              : 'info'),
            typeof durationMs === 'number' ? durationMs : undefined
          );
        }
      } catch (error) {
        fileLogError('Prompt hint toast failed', error);
      }
    }, 350);

    promptHintTimers.set(sessionId, t);
  }

  function extractSessionIdFromEvent(eventObj: UnknownRecord | undefined): string | null {
    if (!eventObj) return null;
    const props = getRecordProp(eventObj, 'properties');
    if (!props) return null;

    // Common locations:
    // - session.* events: properties.sessionID OR properties.info.id
    // - message.* events: properties.info.sessionID OR properties.part.sessionID
    const fromProps = getStringProp(props, 'sessionID');
    if (fromProps) return fromProps;

    const info = getRecordProp(props, 'info');
    const fromInfoSession = getStringProp(info, 'sessionID');
    if (fromInfoSession) return fromInfoSession;
    const fromInfoId = getStringProp(info, 'id');
    if (fromInfoId) return fromInfoId;

    const part = getRecordProp(props, 'part');
    const fromPart = getStringProp(part, 'sessionID');
    if (fromPart) return fromPart;

    return null;
  }

  async function clearPrompt() {
    try {
      const tui = getRecordProp(client, "tui");
      const clearPromptFn = tui ? (tui as unknown as { clearPrompt?: unknown }).clearPrompt : undefined;
      if (typeof clearPromptFn !== "function") return;
      // NOTE: call with the tui context (SDK methods expect `this`).
      await (clearPromptFn as (this: unknown) => Promise<unknown>).call(tui);
    } catch (error) {
      fileLogError("clearPrompt failed", error);
    }
  }

  async function _appendPrompt(text: string) {
    try {
      const tui = getRecordProp(client, "tui");
      const appendPromptFn = tui ? (tui as unknown as { appendPrompt?: unknown }).appendPrompt : undefined;
      if (typeof appendPromptFn !== "function") return;
      // NOTE: call with the tui context (SDK methods expect `this`).
      await (
        appendPromptFn as (this: unknown, args: { body: { text: string } }) => Promise<unknown>
      ).call(tui, { body: { text } });
    } catch (error) {
      fileLogError("appendPrompt failed", error);
    }
  }

  function disarmRatingKiosk(reason: string) {
    if (ratingKiosk.timer) {
      clearTimeout(ratingKiosk.timer);
      ratingKiosk.timer = null;
    }
    if (ratingKiosk.pendingTimer) {
      clearTimeout(ratingKiosk.pendingTimer);
      ratingKiosk.pendingTimer = null;
    }
    if (ratingKiosk.mode !== "idle") {
      fileLog(`Rating kiosk disarmed (${reason})`, "debug");
    }
    ratingKiosk.mode = "idle";
    ratingKiosk.armedAt = 0;
    ratingKiosk.armedUntil = 0;
    ratingKiosk.pendingTenUntil = 0;
    ratingKiosk.typedSinceArm = "";
    ratingKiosk.promptSnapshot = "";
  }

  async function captureKioskRating(score: number) {
    ratingKiosk.lastCapturedAt = Date.now();
    await captureRating(String(score), "kiosk");
    await showToast(`Captured rating ${score}/10`, "success", 2500);
    fileLog(`Kiosk rating captured: ${score}/10`, "info");
  }

  function armRatingKiosk() {
    const now = Date.now();

    if (ratingKiosk.mode !== "idle") return;
    // Avoid re-arming immediately after a rating was captured.
    if (now - ratingKiosk.lastCapturedAt < 15000) return;
    if (now - ratingKiosk.lastArmedAt < RATING_ARM_COOLDOWN_MS) return;
    if (now - lastPromptAppendAt < 1000) return;

    ratingKiosk.lastArmedAt = now;
    ratingKiosk.mode = "armed";
    ratingKiosk.armedAt = now;
    ratingKiosk.armedUntil = now + RATING_ARM_WINDOW_MS;
    ratingKiosk.pendingTenUntil = 0;
    ratingKiosk.typedSinceArm = "";
    ratingKiosk.promptSnapshot = "";

    // Auto-disarm after window.
    ratingKiosk.timer = setTimeout(() => {
      // If still armed/pending when timer fires, disarm silently.
      disarmRatingKiosk("timeout");
    }, RATING_ARM_WINDOW_MS + 50);

    // Fire-and-forget toast (don't await in callers).
    void showToast(
      "Rate: 2-9, or 1 then 0 for 10 (any other key skips)",
      "info",
      RATING_ARM_WINDOW_MS
    );

    fileLog("Rating kiosk armed", "debug");
  }

  async function handleRatingKioskChar(ch: string) {
    const now = Date.now();

    lastPromptAppendAt = now;

    if (ratingKiosk.mode === "idle") return;

    // Expired window.
    if (now > ratingKiosk.armedUntil) {
      disarmRatingKiosk("expired");
      return;
    }

    // If user keeps typing while we're waiting to confirm, treat as prompt.
    if (ratingKiosk.mode === "pendingConfirm") {
      disarmRatingKiosk("pendingConfirm -> prompt");
      return;
    }

    // If user starts typing anything non-rating-ish, skip.
    const isDigit = ch >= "0" && ch <= "9";
    if (!isDigit) {
      disarmRatingKiosk("non-digit");
      return;
    }

    // Only treat ratings if it's the FIRST character typed since arming.
    // This avoids clobbering normal messages that just happen to contain digits.
    const isFirstChar = ratingKiosk.typedSinceArm.length === 0;

    // === Pending 10 handling ===
    if (ratingKiosk.mode === "pendingTen") {
      // If another key arrives, treat this as a normal prompt.
      // The "1" rating is only captured if the user pauses.
      if (now > ratingKiosk.pendingTenUntil) {
        disarmRatingKiosk("pendingTen expired (prompt)");
        return;
      }

      if (ch === "0") {
        await captureKioskRating(10);
        await clearPrompt();
        disarmRatingKiosk("captured 10");
        return;
      }

      disarmRatingKiosk("pendingTen -> prompt");
      return;
    }

    // === Armed handling ===
    if (!isFirstChar) {
      // Once user started typing, stop intercepting.
      disarmRatingKiosk("user typing continued");
      return;
    }

    // First char: interpret.
    if (ch >= "2" && ch <= "9") {
      ratingKiosk.typedSinceArm = ch;
      ratingKiosk.mode = "pendingConfirm";

      if (ratingKiosk.pendingTimer) clearTimeout(ratingKiosk.pendingTimer);
      ratingKiosk.pendingTimer = setTimeout(() => {
        void (async () => {
          if (ratingKiosk.mode !== "pendingConfirm") return;
          await captureKioskRating(parseInt(ch, 10));
          await clearPrompt();
          disarmRatingKiosk(`captured ${ch}`);
        })();
      }, RATING_CONFIRM_SINGLE_MS);

      return;
    }

    if (ch === "1") {
      ratingKiosk.typedSinceArm = "1";
      ratingKiosk.mode = "pendingTen";
      ratingKiosk.pendingTenUntil = now + RATING_PENDING_TEN_MS;

      // If no second key arrives, treat as rating 1 and clear prompt.
      if (ratingKiosk.pendingTimer) clearTimeout(ratingKiosk.pendingTimer);
      ratingKiosk.pendingTimer = setTimeout(() => {
        // Use void + async wrapper to avoid unhandled promise.
        void (async () => {
          if (ratingKiosk.mode !== "pendingTen") return;
          if (Date.now() <= ratingKiosk.pendingTenUntil) return;

          await captureKioskRating(1);
          await clearPrompt();
          disarmRatingKiosk("captured 1 (timeout)");
        })();
      }, RATING_PENDING_TEN_MS + 50);

      return;
    }

    // 0 as first key: treat as skip (avoid weirdness)
    disarmRatingKiosk("0 as first key");
  }

  async function handleRatingKioskPromptAppend(appendedOrFullText: string) {
    const isKioskActive = () => ratingKiosk.mode !== "idle";
    if (!isKioskActive()) return;

    // Some OpenCode builds emit the FULL prompt contents in properties.text,
    // while others emit only the appended delta. Handle both.
    const current = appendedOrFullText;

    let delta = current;
    if (current.startsWith(ratingKiosk.promptSnapshot)) {
      delta = current.slice(ratingKiosk.promptSnapshot.length);
    }

    // Update snapshot best-effort. If current is just delta, this still works.
    ratingKiosk.promptSnapshot = current;

    if (!delta) return;

    // Process each newly appended character in order.
    for (const ch of delta) {
      if (!isKioskActive()) break;
      await handleRatingKioskChar(ch);
    }
  }

  /**
   * Feature flag: enable per-turn response-contract injection and related enforcement.
   *
   * Usage:
   *   ENABLE_PER_TURN_CONTRACT_INJECTION=1 opencode ...
   *
   * When disabled, BOTH of these are disabled:
   *   - PASS 1: per-turn <system-reminder> injection
   *   - PASS 2: post-generation format rewrite (experimental.text.complete)
   */
  const ENABLE_PER_TURN_CONTRACT_INJECTION =
    (process.env.ENABLE_PER_TURN_CONTRACT_INJECTION ?? "").toLowerCase() === "1" ||
    (process.env.ENABLE_PER_TURN_CONTRACT_INJECTION ?? "").toLowerCase() === "true";

  const hooks: Hooks = {
    tool: {
      voice_notify: tool({
        description: "Send a voice notification via local voice server",
        args: {
          message: tool.schema.string().describe("Message to speak"),
          voice_id: tool.schema
            .string()
            .optional()
            .describe("Optional voice_id override"),
          title: tool.schema
            .string()
            .optional()
            .describe("Optional notification title"),
          timeout_ms: tool.schema
            .number()
            .optional()
            .describe("Abort the request after timeout_ms (default: 3000)"),
          fire_and_forget: tool.schema
            .boolean()
            .optional()
            .describe(
              "If true, queue voice notification and return immediately (best-effort)"
            ),
        },
        async execute(args, _context) {
          const controller = new AbortController();
          const timeoutMs =
            typeof args.timeout_ms === "number" && Number.isFinite(args.timeout_ms)
              ? args.timeout_ms
              : 3000;
          const timeout = setTimeout(() => controller.abort(), timeoutMs);

          const body: Record<string, unknown> = {
            message: args.message,
          };

          const defaultVoiceId = getVoiceId();
          if (args.voice_id) body.voice_id = args.voice_id;
          else if (defaultVoiceId) body.voice_id = defaultVoiceId;

          if (args.title) body.title = args.title;

          const run = async () => {
            try {
              const res = await fetch("http://localhost:8888/notify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: controller.signal,
              });

              return res.ok
                ? `ok (${res.status})`
                : `error (${res.status})`;
            } catch (error: unknown) {
              // Fail open: voice server is optional. Return error but don't throw.
              const msg = error instanceof Error ? error.message : String(error);
              return `error (${msg})`;
            } finally {
              clearTimeout(timeout);
            }
          };

          if (args.fire_and_forget) {
            void run();
            return "queued";
          }

          return await run();
        },
      }),
    },

    /**
     * CHAT MESSAGE (pre-LLM)
     * Capture the last user message text per session for later formatting.
     */
    "chat.message": async (input, output) => {
      try {
        const sessionId = input.sessionID;
        if (!sessionId) return;
        if (isSubagentLikeSession(sessionId)) return;
        // Only track user messages.
        if (output?.message?.role !== "user") return;
        const raw = extractTextFromParts(output.parts);
        // Strip leading display directives so later mode detection is correct.
        const text = raw ? raw.replace(/^\s*\/(compact|full)\b\s*/i, "") : raw;
        if (text) {
          lastUserTextBySession.set(sessionId, text);
          sawToolCallThisTurn.set(sessionId, false);

          // Kitty: mark as working as soon as a prompt arrives.
          if (isKittyTabsEnabled()) {
            const seed = text.slice(0, 200);
            kittyTabSeedBySession.set(sessionId, seed);
            kittyTabStateBySession.set(sessionId, "working");
            setKittyTabState("working", seed);
          }
        }
      } catch (error) {
        fileLogError("chat.message handler failed", error);
      }
    },

    /**
     * CODEX / OAUTH PROMPT BLOAT OVERRIDE
     *
     * In OpenAI OAuth (Codex) sessions, OpenCode injects a large harness prompt
     * into `options.instructions` by default. That prompt often conflicts with PAI.
     *
     * Without forking OpenCode, the correct fix is to override `options.instructions`
     * here (runs AFTER OpenCode sets it).
     */
    "chat.params": async (input, output) => {
      try {
        const providerId = getProviderIdFromProvider(getProp(input, "provider"));
        const modelObj = getProp(input, "model");
        const modelProviderId = getProviderIdFromModel(modelObj);
        const modelId = getModelApiId(modelObj);

        // Narrow scope: only OpenAI gpt-5* and only when OpenCode already set instructions.
        const options = getRecordProp(output, "options");
        if (!options) return;
        const existing = (options.instructions as unknown);
        if (typeof existing !== "string" || !existing.trim()) return;

        const isOpenAI = isOpenAIProviderId(providerId || modelProviderId);
        const isGpt5 = isGpt5ModelId(modelId);
        if (!isOpenAI || !isGpt5) return;

        const sessionId = getStringProp(input, "sessionID") ?? "";
        if (sessionId) codexOverrideSessions.add(sessionId);

        // Replace Codex harness prompt with a minimal stub.
        // Authority comes from the system bundle message + configured instructions/AGENTS.
        const stub = [
          "PAI_CODEX_OVERRIDE_V1",
          "Follow the system prompt and configured instructions as highest priority.",
          "Ignore any default coding harness instructions not explicitly provided.",
        ].join("\n");

        options.instructions = stub;
        fileLog(`[codex-override] replaced options.instructions for model=${modelId}`, "debug");
      } catch (error) {
        fileLogError("chat.params codex override failed", error);
      }
    },

    /**
     * PASS 1 (pre-LLM): Silent contract injection
     *
     * Enforce the response contract by injecting a short, binding system reminder
     * into the *current* user message (ephemeral transform).
     *
     * No toasts; no hint-file reading; no loops.
     */
    "experimental.chat.messages.transform": async (_input, output) => {
      try {
        if (!ENABLE_PER_TURN_CONTRACT_INJECTION) return;

        const messages = getProp(output, "messages");
        if (!Array.isArray(messages) || messages.length === 0) return;

        let lastUser: UnknownRecord | undefined;
        for (let i = (messages as UnknownRecord[]).length - 1; i >= 0; i--) {
          const m = (messages as UnknownRecord[])[i];
          if (getStringProp(getProp(m, "info"), "role") === "user") {
            lastUser = m;
            break;
          }
        }
        if (!lastUser) return;

        const info = getProp(lastUser, "info");
        const sessionId = getStringProp(info, "sessionID");
        if (!sessionId) return;
        if (internalCarrierSessions.has(sessionId)) return;

        // Best-effort: cache parent relationships so we can avoid touching subagent sessions.
        await ensureSessionParentCached(sessionId);

        if (!isPrimarySession(sessionId)) return;

        const parts = getProp(lastUser, "parts");
        const rawUserText = extractTextFromParts(parts);

        // Optional display verbosity override via leading directive.
        // Examples:
        // - "/compact ..." (default)
        // - "/full ..."
        const displayMatch = rawUserText.match(/^\s*\/(compact|full)\b\s*/i);
        const displayVerbosity = (displayMatch?.[1] || "compact").toLowerCase();
        const userText = displayMatch ? rawUserText.slice(displayMatch[0].length) : rawUserText;

        const mode = detectEnforcementMode({ userText, toolUsed: false, assistantText: "" });
        const marker = "PAI_ENFORCEMENT_CONTRACT_V25";
        const reminder = [
          "<system-reminder>",
          marker,
          `RequiredDepth: ${mode}`,
          `DisplayVerbosity: ${displayVerbosity.toUpperCase()}`,
          "Rules:",
          "- Your response MUST follow the PAI response contract.",
          "- Your FIRST output token must be 🤖.",
          "- Do NOT request ratings, sentiment, or feedback.",
          "- Do NOT mention toasts, hints, or internal enforcement.",
          "- Do NOT run self-correction loops; output once.",
          "- If DisplayVerbosity is COMPACT: keep output concise.",
          "- If DisplayVerbosity is FULL: include complete scaffolding.",
          "</system-reminder>",
        ].join("\n");

        if (!Array.isArray(parts)) return;
        for (const p of parts as UnknownRecord[]) {
          if (p.type !== "text") continue;
          if (p.ignored) continue;
          if (p.synthetic) continue;
          const t = typeof p.text === "string" ? p.text : "";
          if (!t.trim()) continue;
          if (t.includes(marker)) return;

          // Strip the leading display directive from what the model sees.
          const cleaned = displayMatch ? t.replace(/^\s*\/(compact|full)\b\s*/i, "") : t;
          p.text = `${reminder}\n\n${cleaned}`;
          return;
        }
      } catch (error) {
        fileLogError("messages.transform enforcement injection failed", error);
      }
    },

    /**
     * CONTEXT INJECTION (SessionStart equivalent)
     *
     * Injects PAI skill context into the chat system (CORE fallback).
     * Equivalent to PAI v2.4 load-core-context.ts hook.
     */
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        const sessionId = getStringProp(_input, "sessionID");

        // Internal carrier sessions MUST be side-effect free.
        // Do not create per-session workdirs for them.
        if (sessionId && internalCarrierSessions.has(sessionId)) {
          const scratchpad = await ensureScratchpadSession();
          const scratchpadDir = scratchpad.dir;
          output.system.push(
            [
              "PAI SCRATCHPAD (Binding)",
              `ScratchpadDir: ${scratchpadDir}`,
              "Rules:",
              "- Write ALL temporary artifacts under ScratchpadDir.",
              "- Do NOT write drafts/reviews into the current working directory.",
              "- Only write outside ScratchpadDir when explicitly instructed with an exact destination path.",
            ].join("\n")
          );
          return;
        }

        // Ensure subagent detection works even if session.created wasn't observed yet.
        if (sessionId) {
          await ensureSessionParentCached(sessionId);
        }

        const kind = classifySessionKind(sessionId);
        const storageSessionId = storageSessionIdFor(sessionId);
        let scratchpadDir: string | null = null;

        // Primary sessions may use per-session work scratchpads.
        // Subagents must be minimal and side-effect free.
        if (storageSessionId) {
          scratchpadDir = await getCurrentWorkPathForSession(storageSessionId);
          if (!scratchpadDir) {
            // Ensure the PRIMARY session work directory exists.
            // For subagents, we always bind them to parent session work.
            await createWorkSession(storageSessionId, "work-session");
            scratchpadDir = await getCurrentWorkPathForSession(storageSessionId);
          }
          if (scratchpadDir) scratchpadDir = path.join(scratchpadDir, "scratch");
        }

        if (!scratchpadDir) {
          const scratchpad = await ensureScratchpadSession();
          scratchpadDir = scratchpad.dir;
        }

        // Codex clean-slate: replace OpenCode's assembled system bundle with
        // canonical sources (opencode.json instructions[] + nested AGENTS.md).
        if (sessionId && isCodexOverrideSession(sessionId) && kind === "primary") {
          const projectDir = directory || process.cwd();
          output.system.length = 0;
          output.system.push(
            ...buildCanonicalSystemBundle({
              scratchpadDir,
              projectDir,
              includeSubagentDirective: false,
            })
          );
          fileLog("[codex-override] replaced system bundle", "debug");
          return;
        }

        // Minimal always-on scratchpad directive (non-Codex / subagent).
        output.system.push(
          [
            "PAI SCRATCHPAD (Binding)",
            `ScratchpadDir: ${scratchpadDir}`,
            "Rules:",
            "- Write ALL temporary artifacts under ScratchpadDir.",
            "- Do NOT write drafts/reviews into the current working directory.",
            "- Only write outside ScratchpadDir when explicitly instructed with an exact destination path.",
          ].join("\n")
        );

        // Minimal subagent-only directive. Do not inject heavy PAI context.
        if (sessionId && kind !== "primary") {
          output.system.push(
            [
              "PAI SUBAGENT MODE (Binding)",
              "- Return findings only; be concise and specific.",
              "- Do NOT ask for ratings, sentiment, or feedback.",
              "- Do NOT run format gating or self-correction loops.",
            ].join("\n")
          );
        }
      } catch (error) {
        fileLogError("Context injection failed", error);
        // Don't throw - continue without context
      }
    },

    /**
     * COMPACTION CONTEXT INJECTION (pre-compaction)
     *
     * Injects PAI skill context into the compaction prompt so it survives
     * session.compacted / continuation summaries.
     *
     * See: https://opencode.ai/docs/plugins/ (experimental.session.compacting)
     */
    "experimental.session.compacting": async (_input, output) => {
      try {
        const sessionId = getStringProp(_input, "sessionID");
        const kind = classifySessionKind(sessionId);
        let scratchpadDir: string | null = null;

        // Internal helper sessions must be side-effect free.
        // Do not create per-session workdirs for them.
        if (sessionId && internalCarrierSessions.has(sessionId)) {
          const scratchpad = await ensureScratchpadSession();
          scratchpadDir = scratchpad.dir;

          const outRec = output as unknown as UnknownRecord;
          const existingContext = outRec.context;
          const contextArray: string[] = Array.isArray(existingContext)
            ? (existingContext.filter((v) => typeof v === "string") as string[])
            : [];

          const scratchpadMarker = "PAI SCRATCHPAD (Binding)";
          const alreadyHasScratchpad = contextArray.some((c) => c.includes(scratchpadMarker));
          if (!alreadyHasScratchpad) {
            contextArray.push(
              [
                "PAI SCRATCHPAD (Binding)",
                `ScratchpadDir: ${scratchpadDir}`,
                "Rules:",
                "- Write ALL temporary artifacts under ScratchpadDir.",
                "- Do NOT write drafts/reviews into the current working directory.",
                "- Only write outside ScratchpadDir when explicitly instructed with an exact destination path.",
              ].join("\n")
            );
          }

          outRec.context = contextArray;
          return;
        }

        if (sessionId) {
          scratchpadDir = await getCurrentWorkPathForSession(sessionId);
          if (!scratchpadDir) {
            await createWorkSession(sessionId, "work-session");
            scratchpadDir = await getCurrentWorkPathForSession(sessionId);
          }
          if (scratchpadDir) {
            scratchpadDir = path.join(scratchpadDir, "scratch");
          }
        }

        if (!scratchpadDir) {
          const scratchpad = await ensureScratchpadSession();
          scratchpadDir = scratchpad.dir;
        }
        fileLog("Compaction: injecting context...", "debug");

        // Only inject heavy PAI context during compaction for PRIMARY sessions.
        const result =
          sessionId && kind === "primary"
            ? await loadContext()
            : ({ success: false, error: "subagent_or_unknown", context: "" } as const);

        // output.context is used to seed the compaction summary.
        // Be defensive: ensure it exists and is an array.
        const outRec = output as unknown as UnknownRecord;
        const existingContext = outRec.context;
        const contextArray: string[] = Array.isArray(existingContext)
          ? (existingContext.filter((v) => typeof v === "string") as string[])
          : [];

        const CONTEXT_MARKER = "PAI CORE CONTEXT (Auto-loaded by PAI-OpenCode Plugin)";
        const alreadyHasPaiContext = contextArray.some((c) => c.includes(CONTEXT_MARKER));

        if (result.success && result.context && !alreadyHasPaiContext) {
          contextArray.push(result.context);
          fileLog("Compaction: context injected successfully");
        } else {
          fileLog(
            `Compaction: context injection skipped: ${result.error || "unknown"}`,
            "warn"
          );
        }

        // Inject the same binding scratchpad directive so it survives compaction.
        const scratchpadMarker = "PAI SCRATCHPAD (Binding)";
        const alreadyHasScratchpad = contextArray.some((c) => c.includes(scratchpadMarker));
        if (!alreadyHasScratchpad) {
          contextArray.push(
            [
              "PAI SCRATCHPAD (Binding)",
              `ScratchpadDir: ${scratchpadDir}`,
              "Rules:",
              "- Write ALL temporary artifacts under ScratchpadDir.",
              "- Do NOT write drafts/reviews into the current working directory.",
              "- Only write outside ScratchpadDir when explicitly instructed with an exact destination path.",
            ].join("\n")
          );
        }

        outRec.context = contextArray;
      } catch (error) {
        fileLogError("Compaction context injection failed", error);
        // Don't throw - compaction should continue
      }
    },

    /**
     * PRE-TOOL EXECUTION - SECURITY BLOCKING
     *
     * Called before EVERY tool execution.
     * Can block dangerous commands by THROWING AN ERROR.
     */
    "tool.execute.before": async (input, output) => {
      fileLog(`Tool before: ${input.tool}`, "debug");
      // Args are in OUTPUT, not input! OpenCode API quirk.
      fileLog(
        `output.args: ${JSON.stringify(output.args ?? {}).substring(0, 500)}`,
        "debug"
      );

      // Expand tilde paths in tool args (OpenCode does not expand '~' reliably).
      // This prevents errors like:
      //   ENOENT scandir '~/.config/opencode/...'
      if (output.args && typeof output.args === "object") {
        output.args = normalizeArgsTilde(output.args) as Record<string, unknown>;
      }

      // Mark that this assistant turn used tools (primary sessions only).
      if (input.sessionID && isPrimarySession(input.sessionID)) {
        sawToolCallThisTurn.set(input.sessionID, true);
      }

      // Kitty: if the assistant is about to ask a question, mark awaiting input.
      try {
        const sessionId = (input as UnknownRecord).sessionID as string | undefined;
        if (sessionId && isPrimarySession(sessionId) && isKittyTabsEnabled()) {
          const toolName = String(input.tool || "").toLowerCase();
          const isQuestionTool =
            toolName === "question" ||
            toolName === "askuserquestion" ||
            toolName.includes("question");
          if (isQuestionTool) {
            const seed =
              kittyTabSeedBySession.get(sessionId) ||
              lastUserTextBySession.get(sessionId) ||
              "PAI";
            kittyTabStateBySession.set(sessionId, "awaitingInput");
            setKittyTabState("awaitingInput", seed);
          }
        }
      } catch {
        // Best-effort only.
      }

      // Task spawn rate limiter (guard against runaway subagent loops).
      if (!TASK_RATE_LIMIT_DISABLE && input.tool === "Task" && input.sessionID) {
        const sessionId = input.sessionID;
        const now = Date.now();
        const bucket = taskRateBySession.get(sessionId) ?? {
          windowStart: now,
          total: 0,
          algorithm: 0,
        };
        if (now - bucket.windowStart > TASK_RATE_LIMIT_WINDOW_MS) {
          bucket.windowStart = now;
          bucket.total = 0;
          bucket.algorithm = 0;
        }
        bucket.total += 1;
        const argsRec = output.args as Record<string, unknown> | undefined;
        const subagentType = String(argsRec?.subagent_type ?? "");
        if (subagentType === "Algorithm") bucket.algorithm += 1;
        taskRateBySession.set(sessionId, bucket);
        if (bucket.total > TASK_RATE_LIMIT_MAX || bucket.algorithm > TASK_RATE_LIMIT_ALGO_MAX) {
          const reason =
            bucket.algorithm > TASK_RATE_LIMIT_ALGO_MAX
              ? "algorithm subagent rate limit"
              : "task rate limit";
          fileLog(
            `BLOCKED: ${reason} exceeded (total=${bucket.total}, algorithm=${bucket.algorithm})`,
            "warn"
          );
          throw new Error(
            `[PAI Guard] ${reason} exceeded. Set PAI_TASK_RATE_LIMIT_DISABLE=1 to override.`
          );
        }
      }

      // History capture: responsible for mapping subagent sessions to parent storage.
      {
        const sid = (input as UnknownRecord).sessionID as string | undefined;
        const cid = (input as UnknownRecord).callID as string | undefined;
        await bestEffortHistoryCapture({
          sessionId: sid,
          label: `tool.before:${String(input.tool || "").toLowerCase()}`,
          timeoutMs: HISTORY_CAPTURE_TOOL_TIMEOUT_MS,
          run: () =>
            historyCapture.handleToolBefore(
              {
                tool: input.tool,
                sessionID: sid,
                callID: cid,
              },
              (output.args ?? {}) as Record<string, unknown>
            ),
        });
      }

      // Security validation - throws error to block dangerous commands
      const result = await validateSecurity({
        tool: input.tool,
        args: output.args ?? {},
        sessionID: (input as UnknownRecord).sessionID as string | undefined,
        callID: (input as UnknownRecord).callID as string | undefined,
      });

      if (result.action === "block") {
        fileLog(`BLOCKED: ${result.reason}`, "error");

        // Kitty: show error state before blocking.
        try {
          const sessionId = (input as UnknownRecord).sessionID as string | undefined;
          if (sessionId && isPrimarySession(sessionId) && isKittyTabsEnabled()) {
            const seed =
              kittyTabSeedBySession.get(sessionId) ||
              lastUserTextBySession.get(sessionId) ||
              "PAI";
            kittyTabStateBySession.set(sessionId, "error");
            setKittyTabState("error", seed);
          }
        } catch {
          // Best-effort only.
        }

        // Throwing an error blocks the tool execution
        throw new Error(`[PAI Security] ${result.message || result.reason}`);
      }

      if (result.action === "confirm") {
        fileLog(`WARNING: ${result.reason}`, "warn");
        // For now, log warning but allow - OpenCode will handle its own permission prompt
      }

      fileLog(`Security check passed for ${input.tool}`, "debug");
    },

    /**
     * FORMAT GATE (pre-display)
     * Rewrite invalid assistant output before it reaches the UI.
     */
    "experimental.text.complete": async (input, output) => {
      try {
        // Petteri: keep enforcement gate code, but disable it when per-turn contract injection is disabled.
        // This prevents post-hoc UI rewrites during debugging.
        if (!ENABLE_PER_TURN_CONTRACT_INJECTION) return;

        if (!ENABLE_FORMAT_GATE) return;
        const sessionId = input.sessionID;
        if (!sessionId) return;
        if (internalCarrierSessions.has(sessionId)) return;
        // Format rewriting is primary-session only.
        if (!isPrimarySession(sessionId)) return;

        const text = typeof output.text === "string" ? output.text : "";
        if (!text.trim()) return;
        if (looksLikeJsonOnly(text)) return;

        const userText = lastUserTextBySession.get(sessionId) || "";
        const toolUsed = sawToolCallThisTurn.get(sessionId) === true;

        const mode: EnforcementMode = detectEnforcementMode({ userText, toolUsed, assistantText: text });
        const details = validateOutput(text, mode);
        await appendFormatGateEvidence(sessionId, {
          event: "checked",
          mode,
          ok: details.ok,
          reasons: details.reasons,
          criteriaCount: details.criteriaCount ?? 0,
          toolUsed,
          inLen: text.length,
          messageID: input.messageID,
          partID: input.partID,
        });

        if (details.ok) return;

        const key = `${sessionId}:${input.messageID}:${input.partID}:${mode}`;
        if (rewriteAttemptedByPart.has(key)) {
          const fallback =
            mode === "FULL"
              ? buildFallbackFullWrapper({
                  task: "Enforce required response contract",
                  userText,
                  assistantText: text,
                })
              : buildFallbackMinimalWrapper({
                  task: "Enforce required response contract",
                  assistantText: text,
                });
          output.text = fallback;
          await appendFormatGateEvidence(sessionId, {
            event: "wrapped",
            mode,
            inLen: text.length,
            outLen: fallback.length,
            messageID: input.messageID,
            partID: input.partID,
            error: "repeat enforcement attempt; wrapper applied",
          });
          return;
        }

        // Mark attempted immediately to avoid concurrent duplicate rewrites.
        rewriteAttemptedByPart.add(key);

        const inflight = rewriteInflightByKey.get(key);
        const promise =
          inflight ??
          (async () => {
            const res = await rewriteToFormat({
              mode,
              userText,
              assistantText: text,
            });
            return res;
          })();

        if (!inflight) {
          rewriteInflightByKey.set(
            key,
            promise.finally(() => {
              rewriteInflightByKey.delete(key);
            })
          );
        }

        const rewritten = await promise;

        if (!rewritten.ok) {
          await appendFormatGateEvidence(sessionId, {
            event: "rewrite_failed",
            mode,
            inLen: text.length,
            messageID: input.messageID,
            partID: input.partID,
            error: rewritten.error.slice(0, 500),
          });
          const fallback =
            mode === "FULL"
              ? buildFallbackFullWrapper({
                  task: "Enforce required response contract",
                  userText,
                  assistantText: text,
                })
              : buildFallbackMinimalWrapper({
                  task: "Enforce required response contract",
                  assistantText: text,
                });
          output.text = fallback;
          await appendFormatGateEvidence(sessionId, {
            event: "wrapped",
            mode,
            inLen: text.length,
            outLen: fallback.length,
            messageID: input.messageID,
            partID: input.partID,
          });
          return;
        }

        const details2 = validateOutput(rewritten.text, mode);
        if (!details2.ok) {
          await appendFormatGateEvidence(sessionId, {
            event: "rewrite_failed",
            mode,
            inLen: text.length,
            outLen: rewritten.text.length,
            messageID: input.messageID,
            partID: input.partID,
            error: "rewritten output did not validate",
            reasons: details2.reasons,
          });
          const fallback =
            mode === "FULL"
              ? buildFallbackFullWrapper({
                  task: "Enforce required response contract",
                  userText,
                  assistantText: text,
                })
              : buildFallbackMinimalWrapper({
                  task: "Enforce required response contract",
                  assistantText: text,
                });
          output.text = fallback;
          await appendFormatGateEvidence(sessionId, {
            event: "wrapped",
            mode,
            inLen: text.length,
            outLen: fallback.length,
            messageID: input.messageID,
            partID: input.partID,
          });
          return;
        }

        output.text = rewritten.text;

        if (PAI_DEBUG) fileLog(`EnforcementGate rewrote output (mode=${mode})`, "info");
        await appendFormatGateEvidence(sessionId, {
          event: "rewrote",
          mode,
          inLen: text.length,
          outLen: rewritten.text.length,
          messageID: input.messageID,
          partID: input.partID,
        });
      } catch (error) {
        fileLogError("Enforcement gate failed", error);
      }
    },

    /**
     * PERMISSION GATING (best-effort)
     *
     * OpenCode may ask permission for certain operations. When it does,
     * enforce PAI security policy by mapping:
     * - block   -> deny
     * - confirm -> ask
     * - allow   -> allow
     *
     * Note: Hard enforcement remains in tool.execute.before (throw on block).
     */
    "permission.ask": async (input, output) => {
      try {
        const inRec = input as UnknownRecord;
        const argsRaw = (inRec.args ?? {}) as Record<string, unknown>;
        const args = normalizeArgsTilde(argsRaw) as Record<string, unknown>;

        const result = await validateSecurity({
          tool: String(inRec.tool ?? ""),
          args,
          permission: getStringProp(inRec, "permission"),
        });

        if (result.action === "block") {
          output.status = "deny";
          fileLog(`PERMISSION DENY: ${result.reason}`, "warn");
          return;
        }

        if (result.action === "confirm") {
          output.status = "ask";
          fileLog(`PERMISSION ASK: ${result.reason}`, "info");
          return;
        }

        output.status = "allow";
        fileLog(`PERMISSION ALLOW: ${result.reason}`, "debug");
      } catch (error) {
        // Fail-safe: if validator fails, require confirmation.
        output.status = "ask";
        fileLogError("permission.ask security validation failed", error);
      }
    },

    /**
     * POST-TOOL EXECUTION (PostToolUse + AgentOutputCapture equivalent)
     *
     * Called after tool execution.
     * Captures subagent outputs to MEMORY/RESEARCH/
     * Equivalent to PAI v2.4 AgentOutputCapture hook.
     */
    "tool.execute.after": async (input, output) => {
      try {
        fileLog(`Tool after: ${input.tool}`, "debug");

        {
          const sid = (input as UnknownRecord).sessionID as string | undefined;
          const cid = (input as UnknownRecord).callID as string | undefined;
          await bestEffortHistoryCapture({
            sessionId: sid,
            label: `tool.after:${String(input.tool || "").toLowerCase()}`,
            timeoutMs: HISTORY_CAPTURE_TOOL_TIMEOUT_MS,
            run: () =>
              historyCapture.handleToolAfter(
                {
                  tool: input.tool,
                  sessionID: sid,
                  callID: cid,
                },
                {
                  title: getStringProp(output, "title") ?? undefined,
                  output: getStringProp(output, "output") ?? undefined,
                  metadata: getProp(output, "metadata"),
                }
              ),
          });
        }

        // === AGENT OUTPUT CAPTURE ===
        // Check for Task tool (subagent) completion
        if (isTaskTool(input.tool)) {
          fileLog("Subagent task completed, capturing output...", "info");

          const sessionID = (input as UnknownRecord).sessionID as string | undefined;
          const callID = (input as UnknownRecord).callID as string | undefined;
          const args = historyCapture.getToolArgs(sessionID, callID) ?? {};
          const result = {
            output: getStringProp(output, "output") ?? "",
            metadata: getProp(output, "metadata"),
          };

          const captureResult = await captureAgentOutput(args, result);
          if (captureResult.success && captureResult.filepath) {
            fileLog(`Agent output saved: ${captureResult.filepath}`, "info");
          }
        }
      } catch (error) {
        fileLogError("Tool after hook failed", error);
      }
    },

    /**
     * SESSION LIFECYCLE
     * (SessionStart: skill-restore, SessionEnd: WorkCompletionLearning + SessionSummary)
     *
     * Handles session events like start and end.
     * Equivalent to PAI v2.4 StopOrchestrator + SessionSummary + WorkCompletionLearning.
     */
    event: async (input) => {
      try {
        const eventObj = getRecordProp(input, "event");
        const eventType = getStringProp(eventObj, "type") ?? "";

        const sessionIdForEvent = extractSessionIdFromEvent(eventObj);

        // Cache session parent relationship as early as possible.
        if (eventType === "session.created" || eventType === "session.updated") {
          cacheSessionInfoFromEvent(eventObj);
        }

        // (capability audit logging removed)

        // === TUI RATING KIOSK ===
        // Intercept single keypresses during the short rating window.
        if (eventType === "tui.prompt.append") {
          if (sessionIdForEvent && !isPrimarySession(sessionIdForEvent)) return;
          // Always treat prompt activity as "user is typing" signal
          // (even if kiosk is not armed).
          lastPromptAppendAt = Date.now();

          const props = getRecordProp(eventObj, "properties");
          const data = getProp(eventObj, "data");
          const dataRec = isRecord(data) ? data : undefined;

          const appendedRaw =
            // Official event payload uses properties.text
            props?.text ??
            // Back-compat for older/alternate payload shapes
            (typeof data === "string"
              ? data
              : (getStringProp(dataRec, "text") ??
                  getStringProp(dataRec, "value") ??
                  getStringProp(dataRec, "append") ??
                  ""));

          const appended = String(appendedRaw || "");

          // Debug (rate-limited): confirm whether prompt events fire at all.
          if (ratingKiosk.mode !== "idle") {
            const now = Date.now();
            if (now - lastKioskPromptLogAt > 300) {
              lastKioskPromptLogAt = now;
              fileLog(
                `tui.prompt.append len=${appended.length} kiosk=${ratingKiosk.mode}`,
                "debug"
              );
            }
          }

          if (appended.length > 0) {
            await handleRatingKioskPromptAppend(appended);
          }

          // Don't fall through; this event can be extremely frequent.
          return;
        }

        // Some OpenCode builds report response completion via session.status updates
        // rather than session.idle. If we see an "idle"-like status, arm kiosk.
        let idleLike = false;
        if (eventType === "session.status") {
          try {
            const statusType = getSessionStatusType(eventObj);
            if (statusType === "idle") {
              if (!sessionIdForEvent || isPrimarySession(sessionIdForEvent)) {
                armRatingKiosk();
                fileLog("Rating kiosk armed (session.status)", "debug");
              }
              idleLike = true;
            }
          } catch (error) {
            fileLogError("session.status handling failed", error);
          }
        }

        // === SESSION START ===
        if (eventType.includes("session.created")) {
          cacheSessionInfoFromEvent(eventObj);
          // Subagent session: keep lifecycle hooks minimal (but still let history capture run).
          if (sessionIdForEvent && !isPrimarySession(sessionIdForEvent)) {
            fileLog("=== Subagent Session Started ===", "debug");
          } else {
            fileLog("=== Session Started ===", "info");
          }

          // SKILL RESTORE WORKAROUND
          // OpenCode modifies SKILL.md files when loading them.
          // Restore them to git state on session start.
          try {
            if (sessionIdForEvent && !isPrimarySession(sessionIdForEvent)) {
              // Keep subagent sessions minimal.
              return;
            }
            const restoreResult = await restoreSkillFiles();
            if (restoreResult.restored.length > 0) {
              fileLog(
                `Skill restore: ${restoreResult.restored.length} files restored`,
                "info"
              );
            }
          } catch (error) {
            fileLogError("Skill restore failed", error);
            // Don't throw - session should continue
          }

          // Kitty: mark inference state on new session (primary only).
          try {
            if (
              sessionIdForEvent &&
              isPrimarySession(sessionIdForEvent) &&
              isKittyTabsEnabled()
            ) {
              const seed =
                kittyTabSeedBySession.get(sessionIdForEvent) ||
                lastUserTextBySession.get(sessionIdForEvent) ||
                "PAI";
              kittyTabStateBySession.set(sessionIdForEvent, "inference");
              setKittyTabState("inference", seed);
            }
          } catch {
            // Best-effort only.
          }
        }

        // === RESPONSE COMPLETE (IDLE) ===
        // Treat session.idle as "assistant finished", not "session ended".
        if (eventType === "session.idle" || eventType.includes("session.idle")) {
          if (!sessionIdForEvent || isPrimarySession(sessionIdForEvent)) {
            armRatingKiosk();
            fileLog("Session idle (armed rating kiosk)", "debug");

            // Kitty: mark completed unless we're awaiting input.
            try {
              if (sessionIdForEvent && isKittyTabsEnabled()) {
                const current = kittyTabStateBySession.get(sessionIdForEvent);
                if (current !== "awaitingInput") {
                  const seed =
                    kittyTabSeedBySession.get(sessionIdForEvent) ||
                    lastUserTextBySession.get(sessionIdForEvent) ||
                    "PAI";
                  kittyTabStateBySession.set(sessionIdForEvent, "completed");
                  setKittyTabState("completed", seed);
                }
              }
            } catch {
              // Best-effort only.
            }
          }
          idleLike = true;
        }

        // === SESSION DELETE (hard finalize) ===
        if (eventType === "session.deleted" || eventType.includes("session.deleted")) {
          if (!sessionIdForEvent || isPrimarySession(sessionIdForEvent)) {
            disarmRatingKiosk("session deleted");
            fileLog("=== Session Deleted ===", "info");
          }
          if (sessionIdForEvent) {
            sessionParentById.delete(sessionIdForEvent);
            codexOverrideSessions.delete(sessionIdForEvent);
            internalCarrierSessions.delete(sessionIdForEvent);

            // Cleanup per-session state to avoid unbounded growth.
            lastUserTextBySession.delete(sessionIdForEvent);
            sawToolCallThisTurn.delete(sessionIdForEvent);
            taskRateBySession.delete(sessionIdForEvent);

            kittyTabStateBySession.delete(sessionIdForEvent);
            kittyTabSeedBySession.delete(sessionIdForEvent);

            // Remove any rewrite keys for this session.
            for (const k of rewriteAttemptedByPart) {
              if (k.startsWith(`${sessionIdForEvent}:`)) {
                rewriteAttemptedByPart.delete(k);
              }
            }
            for (const k of rewriteInflightByKey.keys()) {
              if (k.startsWith(`${sessionIdForEvent}:`)) {
                rewriteInflightByKey.delete(k);
              }
            }
          }
        }

        // Log all events for debugging
        fileLog(`Event: ${eventType}`, "debug");

        // History + ISC capture (event-driven)
        void (async () => {
          await bestEffortHistoryCapture({
            sessionId: sessionIdForEvent ?? undefined,
            label: `event:${eventType}`,
            timeoutMs: HISTORY_CAPTURE_EVENT_TIMEOUT_MS,
            run: () => historyCapture.handleEvent(eventObj ?? {}),
          });
        })();

        // Best-effort: show prompt hint after the user message is sent.
        // NOTE: Avoid message.part.updated because that fires while typing.
        if (ENABLE_PROMPT_HINT_TOASTS && eventType === 'message.updated' && sessionIdForEvent) {
          schedulePromptHintToast(sessionIdForEvent);
        }

        // Best-effort: show format reminder after assistant commit.
        if (ENABLE_FORMAT_HINT_TOASTS && idleLike && sessionIdForEvent) {
          scheduleFormatHintToast(sessionIdForEvent);
        }
      } catch (error) {
        fileLogError("Event handler failed", error);
      }
    },
  };

  if (ENABLE_FORMAT_GATE_SELFTEST) {
    // Run async after startup to avoid blocking plugin init.
    setTimeout(() => {
      void runFormatGateSelftest();
    }, 250);
  }

  if (ENABLE_IMPLICIT_SENTIMENT_SELFTEST) {
    setTimeout(() => {
      void runImplicitSentimentSelftest()
        .then((entry) => writeImplicitSentimentSelftest({ ok: true, entry }))
        .catch((error) =>
          writeImplicitSentimentSelftest({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        );
    }, 300);
  }

  return hooks;
};

// Default export for OpenCode plugin system
export default PaiUnified;
