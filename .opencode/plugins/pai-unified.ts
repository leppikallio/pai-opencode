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
import { parseIscResponse } from "./handlers/isc-parser";
import { classifyFormatHint } from "./handlers/format-reminder";
import { fileLog, fileLogError, clearLog } from "./lib/file-logger";
import { getVoiceId } from "./lib/identity";
import { getSessionStatusType } from "./lib/event-normalize";
import {
  ensureDir,
  getLearningDir,
  getStateDir,
  getMemoryDir,
  getCurrentWorkPathForSession,
} from "./lib/paths";
import {
  ensureScratchpadSession,
} from "./lib/scratchpad";
import { createWorkSession } from "./handlers/work-tracker";

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

  // Optional: run a carrier self-test on startup.
  // This avoids needing interactive sessions to validate carrier wiring.
  const ENABLE_FORMAT_GATE_SELFTEST = PAI_DEBUG && process.env.PAI_FORMAT_GATE_SELFTEST === "1";
  const ENABLE_IMPLICIT_SENTIMENT_SELFTEST =
    PAI_DEBUG && process.env.PAI_IMPLICIT_SENTIMENT_SELFTEST === "1";

  // Default-off: Pass-1 hint toasts are for debugging only.
  // The underlying artifacts (PROMPT_HINTS.jsonl / FORMAT_HINTS.jsonl) still persist.
  const ENABLE_PROMPT_HINT_TOASTS = PAI_DEBUG && process.env.PAI_ENABLE_PROMPT_HINT_TOASTS === "1";
  const ENABLE_FORMAT_HINT_TOASTS = PAI_DEBUG && process.env.PAI_ENABLE_FORMAT_HINT_TOASTS === "1";

  // Format enforcement gate (v2.5 intent): rewrite invalid assistant output before display.
  // Default-on: disable only with PAI_ENABLE_FORMAT_GATE=0.
  const ENABLE_FORMAT_GATE = process.env.PAI_ENABLE_FORMAT_GATE !== "0";
  // Default-on per Petteri: force a rewrite even if already valid.
  // Disable (debug only) with: PAI_FORMAT_GATE_FORCE=0
  const FORMAT_GATE_FORCE = process.env.PAI_FORMAT_GATE_FORCE !== "0";
  // Debug-only: write per-session FORMAT_GATE.jsonl evidence.
  const FORMAT_GATE_WRITE_EVIDENCE = PAI_DEBUG && process.env.PAI_FORMAT_GATE_WRITE_EVIDENCE !== "0";

  const internalCarrierSessions = new Set<string>();
  const lastUserTextBySession = new Map<string, string>();
  const sawToolCallThisTurn = new Map<string, boolean>();
  const forcedRewriteDoneBySession = new Set<string>();

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

  function extractTextFromParts(parts: unknown): string {
    const arr = Array.isArray(parts) ? parts : [];
    return arr
      .filter((p) => p && typeof p === "object" && (p as UnknownRecord).type === "text")
      .map((p) => ((p as UnknownRecord).text as string) || "")
      .join("")
      .trim();
  }

  function looksLikeJsonOnly(text: string): boolean {
    const t = text.trim();
    if (!t) return false;
    if (!(t.startsWith("{") || t.startsWith("["))) return false;
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
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

  function validateMinimalFormat(text: string): boolean {
    const hasVoiceLine = /^🗣️\s*[^:\n]{1,40}:/m.test(text);
    const hasSummaryLine = /^📋 SUMMARY:/m.test(text);
    return hasVoiceLine && hasSummaryLine;
  }

  function validateFullFormatDetailed(text: string): {
    ok: boolean;
    criteriaCount: number;
    reasons: string[];
  } {
    const hint = classifyFormatHint(text, "");
    const reasons: string[] = [];

    if (!hint.features.hasPaiAlgorithmHeader) reasons.push("missing_pai_algorithm_header");
    if (!hint.features.hasVoiceLine) reasons.push("missing_voice_line");
    if (!hint.features.hasSummaryLine) reasons.push("missing_summary_line");
    if (!hint.features.hasIscTracker) reasons.push("missing_isc_tracker");
    if (hint.features.phaseCount < 5) reasons.push("missing_phases");

    const parsed = parseIscResponse(text);
    const criteriaCount = parsed.criteria.length;
    if (parsed.attempted && criteriaCount === 0) reasons.push("empty_isc_criteria");

    return { ok: reasons.length === 0, criteriaCount, reasons };
  }

  function validateFullFormat(text: string): boolean {
    return validateFullFormatDetailed(text).ok;
  }

  function buildFallbackFullWrapper(opts: {
    task: string;
    userText: string;
    assistantText: string;
  }): string {
    const original = opts.assistantText.trim();
    const clipped = original.length > 4000 ? `${original.slice(0, 4000)}\n\n[truncated]` : original;

    return [
      "🤖 PAI ALGORITHM ══════════════════════════════════════════════════════════════",
      `   Task: ${opts.task}`,
      "   [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0% → IDEAL STATE",
      "",
      "━━━ 👁️  O B S E R V E ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1/7",
      "",
      "**Observations:**",
      "- What exists now: assistant output failed format validation",
      "- What you explicitly asked: see user message below",
      "- Relevant context: original assistant output preserved in OUTPUT",
      "",
      "**🔧 Capabilities:** direct",
      "",
      "━━━ 🧠  T H I N K ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2/7",
      "",
      "**Analysis:**",
      "- Goal: enforce required response format deterministically",
      "- Approach: wrap original output in required structure",
      "",
      "**🔧 Capabilities:** direct",
      "",
      "━━━ 📋  P L A N ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 3/7",
      "",
      "**IDEAL:** Output conforms to required PAI response structure.",
      "",
      "🎯 ISC TRACKER ════════════════════════════════════════════════════════════════",
      "│ # │ Criterion (exactly 8 words)                 │ Status          │ Δ      │",
      "├───┼─────────────────────────────────────────────┼─────────────────┼────────┤",
      "│ 1 │ Required response format fields are present │ ✅ VERIFIED     │ ★ ADDED │",
      "├───┴─────────────────────────────────────────────┴─────────────────┴────────┤",
      "│ ⚠️ ANTI-CRITERIA                                                          │",
      "├───┬─────────────────────────────────────────────┬──────────────────────────┤",
      "│ ! │ No tool results invented in wrapper output  │ ✅ AVOIDED               │",
      "└───┴─────────────────────────────────────────────┴──────────────────────────┘",
      "",
      "**🔧 Capabilities:** direct",
      "",
      "━━━ 🔨  B U I L D ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 4/7",
      "",
      "**Building:**",
      "- Formatting wrapper around original assistant output",
      "",
      "**🔧 Capabilities:** direct",
      "",
      "━━━ ⚡  E X E C U T E ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 5/7",
      "",
      "**Actions:**",
      "- Wrapped original assistant output into required format",
      "",
      "**🔧 Capabilities:** direct",
      "",
      "━━━ ✅  V E R I F Y ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 6/7",
      "",
      "🎯 FINAL ISC STATE ════════════════════════════════════════════════════════════",
      "│ # │ Criterion                          │ Status      │ Evidence │",
      "├───┼────────────────────────────────────┼─────────────┼──────────┤",
      "│ 1 │ Required response format fields are present │ ✅ VERIFIED │ wrapper applied │",
      "└───┴────────────────────────────────────┴─────────────┴──────────┘",
      "",
      "**🔧 Capabilities:** direct",
      "",
      "━━━ 📤  O U T P U T ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 6.5/7",
      "",
      "📊 RESULTS FROM: Original assistant output",
      "────────────────────────────────────────────────────────────────────────────────",
      "USER_MESSAGE:",
      opts.userText || "(unknown)",
      "",
      "ASSISTANT_OUTPUT (original):",
      clipped || "(empty)",
      "────────────────────────────────────────────────────────────────────────────────",
      "",
      "━━━ 📚  L E A R N ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 7/7",
      "",
      "📋 SUMMARY: I wrapped the assistant output to satisfy format requirements.",
      "➡️ NEXT: Investigate why rewrite failed; see FORMAT_GATE.jsonl.",
      "",
      "⭐ RATE (1-10):",
      "",
      "🗣️ Marvin: I enforced the required format by wrapping the assistant output. Original content preserved.",
    ].join("\n");
  }

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
              "Output MUST be exactly two lines:",
              "1) 📋 SUMMARY: <one sentence>",
              "2) 🗣️ Marvin: <max 16 words, factual>",
              "Do not add any other lines.",
              "Do not mention rewriting.",
            ].join("\n")
          : [
              "You rewrite assistant output into the required PAI phased algorithm format.",
              "Requirements:",
              "- Must include: 🤖 PAI ALGORITHM header, all 7 phases, and an ISC table.",
              "- Must include: 📋 SUMMARY line and 🗣️ Marvin voice line (max 16 words).",
              "- Preserve the original meaning; do not invent tool results.",
              "- No toasts, no meta commentary, no apologies.",
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
      internalCarrierSessions.delete(sid);
      void sessionApi
        .delete({
          path: { id: sid },
          query: directory ? { directory } : undefined,
        })
        .catch(() => {});
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
    const missingCriteriaCheck = validateFullFormatDetailed(fullMissingCriteria);

    await writeFormatGateSelftest({
      ts: startedAt,
      ok: {
        minimal: minimal.ok,
        full: full.ok,
      },
      validated: {
        minimal: minimal.ok ? validateMinimalFormat(minimal.text) : false,
        full: full.ok ? validateFullFormat(full.text) : false,
      },
      iscGate: {
        missingCriteriaOk: missingCriteriaCheck.ok,
        missingCriteriaReasons: missingCriteriaCheck.reasons,
        missingCriteriaCount: missingCriteriaCheck.criteriaCount,
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
        },
        async execute(args, _context) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          try {
            const body: Record<string, unknown> = {
              message: args.message,
            };

            const defaultVoiceId = getVoiceId();
            if (args.voice_id) body.voice_id = args.voice_id;
            else if (defaultVoiceId) body.voice_id = defaultVoiceId;

            if (args.title) body.title = args.title;

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
        // Only track user messages.
        if (output?.message?.role !== "user") return;
        const text = extractTextFromParts(output.parts);
        if (text) {
          lastUserTextBySession.set(sessionId, text);
          sawToolCallThisTurn.set(sessionId, false);
        }
      } catch (error) {
        fileLogError("chat.message handler failed", error);
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
        let scratchpadDir: string | null = null;

        if (sessionId) {
          scratchpadDir = await getCurrentWorkPathForSession(sessionId);
          if (!scratchpadDir) {
            // Create a work session early so ScratchpadDir is stable.
            await createWorkSession(sessionId, "work-session");
            scratchpadDir = await getCurrentWorkPathForSession(sessionId);
          }
          if (scratchpadDir) {
            scratchpadDir = path.join(scratchpadDir, "scratch");
          }
        }

        if (!scratchpadDir) {
          // Fallback for contexts without a sessionID (e.g. agent generation).
          const scratchpad = await ensureScratchpadSession();
          scratchpadDir = scratchpad.dir;
        }
        fileLog("Injecting context...");

        // Best-effort: initialize expected MEMORY state files so docs stay accurate.
        try {
          await ensureDir(getStateDir());
          await ensureDir(path.join(getLearningDir(), "SIGNALS"));
          await ensureDir(path.join(getMemoryDir(), "PAISYSTEMUPDATES"));

          const currentWorkFile = path.join(getStateDir(), "current-work.json");
          if (!fs.existsSync(currentWorkFile)) {
            await fs.promises.writeFile(
              currentWorkFile,
              JSON.stringify({ v: "0.2", updated_at: new Date().toISOString(), sessions: {} }, null, 2)
            );
          }

          const ratingsFile = path.join(getLearningDir(), "SIGNALS", "ratings.jsonl");
          if (!fs.existsSync(ratingsFile)) {
            await fs.promises.writeFile(ratingsFile, "");
          }

          const updatesIndex = path.join(getMemoryDir(), "PAISYSTEMUPDATES", "index.json");
          if (!fs.existsSync(updatesIndex)) {
            await fs.promises.writeFile(updatesIndex, JSON.stringify({ updates: [] }, null, 2));
          }

          const updatesChangelog = path.join(getMemoryDir(), "PAISYSTEMUPDATES", "CHANGELOG.md");
          if (!fs.existsSync(updatesChangelog)) {
            await fs.promises.writeFile(
              updatesChangelog,
              "# PAI System Updates Changelog\n\nThis file is generated/updated by System tooling.\n"
            );
          }
        } catch (error) {
          fileLogError("Memory initialization failed", error);
        }

        const result = await loadContext();

        if (result.success && result.context) {
          output.system.push(result.context);
          fileLog("Context injected successfully");
        } else {
          fileLog(
            `Context injection skipped: ${result.error || "unknown"}`,
            "warn"
          );
        }

        // Inject a short, binding scratchpad directive with the per-session path.
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
        let scratchpadDir: string | null = null;

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
        fileLog("Compaction: injecting context...");

        const result = await loadContext();

        // output.context is used to seed the compaction summary.
        // Be defensive: ensure it exists and is an array.
        const outRec = output as unknown as UnknownRecord;
        const existingContext = outRec.context;
        const contextArray: string[] = Array.isArray(existingContext)
          ? (existingContext.filter((v) => typeof v === "string") as string[])
          : [];

        if (result.success && result.context) {
          contextArray.push(result.context);
          fileLog("Compaction: context injected successfully");
        } else {
          fileLog(
            `Compaction: context injection skipped: ${result.error || "unknown"}`,
            "warn"
          );
        }

        // Inject the same binding scratchpad directive so it survives compaction.
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

      // Mark that this assistant turn used tools.
      if (input.sessionID) {
        sawToolCallThisTurn.set(input.sessionID, true);
      }

      await historyCapture.handleToolBefore(
        {
          tool: input.tool,
          sessionID: (input as UnknownRecord).sessionID as string | undefined,
          callID: (input as UnknownRecord).callID as string | undefined,
        },
        (output.args ?? {}) as Record<string, unknown>
      );

      // Security validation - throws error to block dangerous commands
      const result = await validateSecurity({
        tool: input.tool,
        args: output.args ?? {},
        sessionID: (input as UnknownRecord).sessionID as string | undefined,
        callID: (input as UnknownRecord).callID as string | undefined,
      });

      if (result.action === "block") {
        fileLog(`BLOCKED: ${result.reason}`, "error");
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
        if (!ENABLE_FORMAT_GATE) return;
        const sessionId = input.sessionID;
        if (!sessionId) return;
        if (internalCarrierSessions.has(sessionId)) return;

        const text = typeof output.text === "string" ? output.text : "";
        if (!text.trim()) return;
        if (looksLikeJsonOnly(text)) return;

        const userText = lastUserTextBySession.get(sessionId) || "";
        const toolUsed = sawToolCallThisTurn.get(sessionId) === true;

        const mode: "MINIMAL" | "FULL" = toolUsed || text.length >= 600 ? "FULL" : "MINIMAL";

        const fullDetails = mode === "FULL" ? validateFullFormatDetailed(text) : null;
        const ok = mode === "FULL" ? fullDetails?.ok === true : validateMinimalFormat(text);
        const shouldForce = FORMAT_GATE_FORCE && !forcedRewriteDoneBySession.has(sessionId);
        await appendFormatGateEvidence(sessionId, {
          event: "checked",
          mode,
          ok,
          forced: shouldForce,
          toolUsed,
          inLen: text.length,
          messageID: input.messageID,
          partID: input.partID,
          ...(mode === "FULL"
            ? {
                criteriaCount: fullDetails?.criteriaCount ?? 0,
                reasons: fullDetails?.reasons ?? [],
              }
            : {}),
        });

        if (ok && !shouldForce) return;

        const rewritten = await rewriteToFormat({
          mode,
          userText,
          assistantText: text,
        });

        // Ensure force-mode is one-shot, even if rewrite fails.
        if (shouldForce) forcedRewriteDoneBySession.add(sessionId);

        if (!rewritten.ok) {
          await appendFormatGateEvidence(sessionId, {
            event: "rewrite_failed",
            mode,
            forced: shouldForce,
            inLen: text.length,
            messageID: input.messageID,
            partID: input.partID,
            error: rewritten.error.slice(0, 500),
          });
          const fallback = buildFallbackFullWrapper({
            task: "Enforce required response format",
            userText,
            assistantText: text,
          });
          if (validateFullFormat(fallback)) {
            output.text = fallback;
            await appendFormatGateEvidence(sessionId, {
              event: "rewrote_fallback",
              mode: "FULL",
              forced: shouldForce,
              inLen: text.length,
              outLen: fallback.length,
              messageID: input.messageID,
              partID: input.partID,
            });
          }
          return;
        }

        const ok2 = mode === "FULL" ? validateFullFormat(rewritten.text) : validateMinimalFormat(rewritten.text);
        if (!ok2) {
          await appendFormatGateEvidence(sessionId, {
            event: "rewrite_failed",
            mode,
            forced: shouldForce,
            inLen: text.length,
            outLen: rewritten.text.length,
            messageID: input.messageID,
            partID: input.partID,
            error: "rewritten output did not validate",
          });
          const fallback = buildFallbackFullWrapper({
            task: "Enforce required response format",
            userText,
            assistantText: text,
          });
          if (validateFullFormat(fallback)) {
            output.text = fallback;
            await appendFormatGateEvidence(sessionId, {
              event: "rewrote_fallback",
              mode: "FULL",
              forced: shouldForce,
              inLen: text.length,
              outLen: fallback.length,
              messageID: input.messageID,
              partID: input.partID,
            });
          }
          return;
        }

        output.text = rewritten.text;

        if (PAI_DEBUG) fileLog(`FormatGate rewrote output (mode=${mode} forced=${shouldForce})`, "info");
        await appendFormatGateEvidence(sessionId, {
          event: "rewrote",
          mode,
          forced: shouldForce,
          inLen: text.length,
          outLen: rewritten.text.length,
          messageID: input.messageID,
          partID: input.partID,
        });
      } catch (error) {
        fileLogError("Format gate failed", error);
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

        await historyCapture.handleToolAfter(
          {
            tool: input.tool,
            sessionID: (input as UnknownRecord).sessionID as string | undefined,
            callID: (input as UnknownRecord).callID as string | undefined,
          },
          {
            title: getStringProp(output, "title") ?? undefined,
            output: getStringProp(output, "output") ?? undefined,
            metadata: getProp(output, "metadata"),
          }
        );

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

        // (capability audit logging removed)

        // === TUI RATING KIOSK ===
        // Intercept single keypresses during the short rating window.
        if (eventType === "tui.prompt.append") {
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
              armRatingKiosk();
              fileLog("Rating kiosk armed (session.status)", "debug");
              idleLike = true;
            }
          } catch (error) {
            fileLogError("session.status handling failed", error);
          }
        }

        // === SESSION START ===
        if (eventType.includes("session.created")) {
          fileLog("=== Session Started ===", "info");

          // SKILL RESTORE WORKAROUND
          // OpenCode modifies SKILL.md files when loading them.
          // Restore them to git state on session start.
          try {
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
        }

        // === RESPONSE COMPLETE (IDLE) ===
        // Treat session.idle as "assistant finished", not "session ended".
        if (eventType === "session.idle" || eventType.includes("session.idle")) {
          armRatingKiosk();
          fileLog("Session idle (armed rating kiosk)", "debug");
          idleLike = true;
        }

        // === SESSION DELETE (hard finalize) ===
        if (eventType === "session.deleted" || eventType.includes("session.deleted")) {
          disarmRatingKiosk("session deleted");
          fileLog("=== Session Deleted ===", "info");
        }

        // Log all events for debugging
        fileLog(`Event: ${eventType}`, "debug");

        // History + ISC capture (event-driven)
        await historyCapture.handleEvent(eventObj ?? {});

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
