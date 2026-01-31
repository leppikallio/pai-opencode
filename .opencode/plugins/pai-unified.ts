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
import {
  createWorkSession,
  completeWorkSession,
  getCurrentSession,
  appendToThread,
} from "./handlers/work-tracker";
import { captureRating, detectRating } from "./handlers/rating-capture";
import {
  captureAgentOutput,
  isTaskTool,
} from "./handlers/agent-capture";
import { extractLearningsFromWork } from "./handlers/learning-capture";
import { fileLog, fileLogError, clearLog } from "./lib/file-logger";
import { getVoiceId } from "./lib/identity";
import { ensureDir, getLearningDir, getStateDir, getMemoryDir } from "./lib/paths";
import {
  ensureScratchpadSession,
  clearScratchpadSession,
} from "./lib/scratchpad";

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
     * CONTEXT INJECTION (SessionStart equivalent)
     *
     * Injects CORE skill context into the chat system.
     * Equivalent to PAI v2.4 load-core-context.ts hook.
     */
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        const scratchpad = await ensureScratchpadSession();
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
              JSON.stringify({ work_dir: null }, null, 2)
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
            `ScratchpadDir: ${scratchpad.dir}`,
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
     * Injects CORE skill context into the compaction prompt so it survives
     * session.compacted / continuation summaries.
     *
     * See: https://opencode.ai/docs/plugins/ (experimental.session.compacting)
     */
    "experimental.session.compacting": async (_input, output) => {
      try {
        const scratchpad = await ensureScratchpadSession();
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
            `ScratchpadDir: ${scratchpad.dir}`,
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

      // Security validation - throws error to block dangerous commands
      const result = await validateSecurity({
        tool: input.tool,
        args: output.args ?? {},
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
     * POST-TOOL EXECUTION (PostToolUse + AgentOutputCapture equivalent)
     *
     * Called after tool execution.
     * Captures subagent outputs to MEMORY/RESEARCH/
     * Equivalent to PAI v2.4 AgentOutputCapture hook.
     */
    "tool.execute.after": async (input, output) => {
      try {
        fileLog(`Tool after: ${input.tool}`, "debug");

        // === AGENT OUTPUT CAPTURE ===
        // Check for Task tool (subagent) completion
        if (isTaskTool(input.tool)) {
          fileLog("Subagent task completed, capturing output...", "info");

          const args = getRecordProp(input, "args") ?? getRecordProp(output, "args") ?? {};
          const result = getProp(output, "result");

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
     * CHAT MESSAGE HANDLER
     * (UserPromptSubmit: AutoWorkCreation + ExplicitRatingCapture + FormatReminder)
     *
     * Called when user submits a message.
     * Equivalent to PAI v2.4 AutoWorkCreation + ExplicitRatingCapture hooks.
     */
    "chat.message": async (input, _output) => {
      try {
        const msg = getRecordProp(input, "message");
        const role = getStringProp(msg, "role") ?? "unknown";
        const content = getStringProp(msg, "content") ?? "";

        // Only process user messages
        if (role !== "user") return;

        fileLog(
          `[chat.message] User: ${content.substring(0, 100)}...`,
          "debug"
        );

        // === AUTO-WORK CREATION ===
        // Create work session on first user prompt if none exists
        const currentSession = getCurrentSession();
        if (!currentSession) {
          const workResult = await createWorkSession(content);
          if (workResult.success && workResult.session) {
            fileLog(`Work session started: ${workResult.session.id}`, "info");
          }
        } else {
          // Append to existing thread
          await appendToThread(`**User:** ${content.substring(0, 200)}...`);
        }

        // === EXPLICIT RATING CAPTURE ===
        // Check if message is a rating (e.g., "8", "7 - needs work", "9/10")
        const rating = detectRating(content);
        if (rating) {
          // Prevent the kiosk from immediately re-arming after the user submits a rating.
          ratingKiosk.lastCapturedAt = Date.now();
          disarmRatingKiosk("explicit rating message");
          const ratingResult = await captureRating(content, "user message");
          if (ratingResult.success && ratingResult.rating) {
            fileLog(`Rating captured: ${ratingResult.rating.score}/10`, "info");
          }
        }

        // === FORMAT REMINDER ===
        // For non-trivial prompts, nudge towards Algorithm format
        // (Not blocking, just logging for awareness)
        if (content.length > 100 && !content.toLowerCase().includes("trivial")) {
          fileLog("Non-trivial prompt detected, Algorithm format recommended", "debug");
        }
      } catch (error) {
        fileLogError("chat.message handler failed", error);
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
        if (eventType === "session.status") {
          try {
            const data = getProp(eventObj, "data");
            const dataRec = isRecord(data) ? data : {};
            const statusStr = String(
              getProp(dataRec, "status") ??
                getProp(dataRec, "state") ??
                getProp(dataRec, "phase") ??
                ""
            ).toLowerCase();
            const dataStr = JSON.stringify(dataRec).toLowerCase();

            if (statusStr === "idle" || dataStr.includes("\"idle\"")) {
              armRatingKiosk();
              fileLog("Rating kiosk armed (session.status)", "debug");
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
        }

        // === SESSION END ===
        if (eventType === "session.ended" || eventType.includes("session.ended")) {
          disarmRatingKiosk("session ended");

          fileLog("=== Session Ended ===", "info");

          // Session scratchpad cleanup (best-effort)
          try {
            await clearScratchpadSession();
          } catch (error) {
            fileLogError("Scratchpad cleanup failed", error);
          }

          // WORK COMPLETION LEARNING
          // Extract learnings from the work session
          try {
            const learningResult = await extractLearningsFromWork();
            if (learningResult.success && learningResult.learnings.length > 0) {
              fileLog(
                `Extracted ${learningResult.learnings.length} learnings`,
                "info"
              );
            }
          } catch (error) {
            fileLogError("Learning extraction failed", error);
          }

          // SESSION SUMMARY
          // Complete the work session
          try {
            const completeResult = await completeWorkSession();
            if (completeResult.success) {
              fileLog("Work session completed", "info");
            }
          } catch (error) {
            fileLogError("Work session completion failed", error);
          }
        }

        // Log all events for debugging
        fileLog(`Event: ${eventType}`, "debug");
      } catch (error) {
        fileLogError("Event handler failed", error);
      }
    },
  };

  return hooks;
};

// Default export for OpenCode plugin system
export default PaiUnified;
