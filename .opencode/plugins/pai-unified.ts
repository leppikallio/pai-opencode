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
import os from "os";
import path from "path";
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
import {
  ensureScratchpadSession,
  clearScratchpadSession,
} from "./lib/scratchpad";

type ToastVariant = "info" | "success" | "warning" | "error";

type RatingKioskMode = "idle" | "armed" | "pendingTen";

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
}

/**
 * PAI Unified Plugin
 *
 * Exports all hooks in a single plugin for OpenCode.
 * Implements PAI v2.4 hook functionality.
 */
export const PaiUnified: Plugin = async (ctx) => {
  const client = (ctx as any)?.client;

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
  };

  // If the user is actively typing, don't pop the rating kiosk.
  let lastPromptAppendAt = 0;

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
      if (!client?.tui?.showToast) return;
      // duration is not documented in all builds; pass through best-effort.
      await client.tui.showToast({
        body: {
          message,
          variant,
          ...(typeof durationMs === "number" ? { duration: durationMs } : {}),
        } as any,
      });
    } catch (error) {
      fileLogError("Toast failed", error);
    }
  }

  async function clearPrompt() {
    try {
      if (!client?.tui?.clearPrompt) return;
      await client.tui.clearPrompt();
    } catch (error) {
      fileLogError("clearPrompt failed", error);
    }
  }

  async function appendPrompt(text: string) {
    try {
      if (!client?.tui?.appendPrompt) return;
      await client.tui.appendPrompt({ body: { text } });
    } catch (error) {
      fileLogError("appendPrompt failed", error);
    }
  }

  function disarmRatingKiosk(reason: string) {
    if (ratingKiosk.timer) {
      clearTimeout(ratingKiosk.timer);
      ratingKiosk.timer = null;
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
    if (now > ratingKiosk.armedUntil && ratingKiosk.mode === "armed") {
      disarmRatingKiosk("expired");
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
      // If pending expired, treat as rating 1 and restore this char.
      if (now > ratingKiosk.pendingTenUntil) {
        await captureKioskRating(1);
        await clearPrompt();
        disarmRatingKiosk("pendingTen expired");
        await appendPrompt(ch);
        return;
      }

      // Expecting second key.
      if (ch === "0") {
        await captureKioskRating(10);
        await clearPrompt();
        disarmRatingKiosk("captured 10");
        return;
      }

      // Any other digit -> treat as rating 1, but keep the digit as message input.
      await captureKioskRating(1);
      await clearPrompt();
      disarmRatingKiosk("captured 1 (fallback)");
      await appendPrompt(ch);
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
      await captureKioskRating(parseInt(ch, 10));
      await clearPrompt();
      disarmRatingKiosk(`captured ${ch}`);
      return;
    }

    if (ch === "1") {
      ratingKiosk.typedSinceArm = "1";
      ratingKiosk.mode = "pendingTen";
      ratingKiosk.pendingTenUntil = now + RATING_PENDING_TEN_MS;

      // If no second key arrives, treat as rating 1 and clear prompt.
      if (ratingKiosk.timer) clearTimeout(ratingKiosk.timer);
      ratingKiosk.timer = setTimeout(() => {
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
          const timeout = setTimeout(() => controller.abort(), 2500);
          try {
            const body: Record<string, unknown> = {
              message: args.message,
            };
            if (args.voice_id) body.voice_id = args.voice_id;
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
          } catch (error: any) {
            // Fail open: voice server is optional. Return error but don't throw.
            return `error (${error?.message || String(error)})`;
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
    "experimental.chat.system.transform": async (input, output) => {
      try {
        const scratchpad = await ensureScratchpadSession();
        fileLog("Injecting context...");

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
     * SECURITY BLOCKING (PreToolUse exit(2) equivalent)
     *
     * Validates tool executions for security threats.
     * Can BLOCK dangerous operations by setting output.status = "deny".
     * Equivalent to PAI v2.4 security-validator.ts hook.
     */
    "permission.ask": async (input, output) => {
      try {
        fileLog(`>>> PERMISSION.ASK CALLED <<<`, "info");
        fileLog(
          `permission.ask input: ${JSON.stringify(input).substring(0, 200)}`,
          "debug"
        );

        // Extract tool info from Permission input
        const tool = (input as any).tool || "unknown";
        const args = (input as any).args || {};

        const result = await validateSecurity({ tool, args });

        switch (result.action) {
          case "block":
            output.status = "deny";
            fileLog(`BLOCKED: ${result.reason}`, "error");
            break;

          case "confirm":
            output.status = "ask";
            fileLog(`CONFIRM: ${result.reason}`, "warn");
            break;

          case "allow":
          default:
            // Don't modify output.status - let it proceed
            fileLog(`ALLOWED: ${tool}`, "debug");
            break;
        }
      } catch (error) {
        fileLogError("Permission check failed", error);
        // Fail-open: on error, don't block
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
      //   ENOENT scandir '/Users/zuul/~/.config/opencode/...'
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

          const args = (input as any).args || (output as any).args || {};
          const result = (output as any).result;

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
    "chat.message": async (input, output) => {
      try {
        const role = (input as any).message?.role || "unknown";
        const content = (input as any).message?.content || "";

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
        const eventType = (input.event as any)?.type || "";

        // === TUI RATING KIOSK ===
        // Intercept single keypresses during the short rating window.
        if (eventType === "tui.prompt.append") {
          const props = (input.event as any)?.properties;
          const data = (input.event as any)?.data;

          const appendedRaw =
            // Official event payload uses properties.text
            props?.text ??
            // Back-compat for older/alternate payload shapes
            (typeof data === "string"
              ? data
              : (data?.text ?? data?.value ?? data?.append ?? ""));

          const appended = String(appendedRaw || "");
          if (appended.length > 0) {
            await handleRatingKioskPromptAppend(appended);
          }

          // Don't spam the log for every keypress.
          return;
        }

        // Some OpenCode builds report response completion via session.status updates
        // rather than session.idle. If we see an "idle"-like status, arm kiosk.
        if (eventType === "session.status") {
          try {
            const data = (input.event as any)?.data ?? {};
            const statusStr = String(
              (data as any)?.status ?? (data as any)?.state ?? (data as any)?.phase ?? ""
            ).toLowerCase();
            const dataStr = JSON.stringify(data).toLowerCase();

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
