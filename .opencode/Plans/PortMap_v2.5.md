# PortMap v2.5 (Upstream v2.5.0 -> pai-opencode)

This is the comprehensive mapping document. It is intentionally bigger than the 3 headline Algorithm upgrades.

Canonical path: `.opencode/Plans/PortMap_v2.5.md`

Legend:
- ADOPT: implement equivalent behavior (same intent)
- ADAPT: implement using OpenCode-native mechanisms (plugins, server, tools)
- DISCARD: out-of-scope for OpenCode or privacy-sensitive (must justify)

## 1) Headline Algorithm Changes (From v2.5.0 notes)

| Feature | Tag | OpenCode mapping | Status |
|---|---|---|---|
| Two-Pass Capability Selection | ADAPT | Pass-1 hints (toast+artifacts), Pass-2 THINK enforcement | DONE (core), needs parity audit |
| Thinking tools justify-exclusion | ADOPT | CORE doc enforcement | DONE |
| Parallel-by-default execution | ADOPT | Use `multi_tool_use.parallel` for independent work | DONE |
| Composition patterns | ADOPT | Require naming pattern in PLAN | DONE |
| Mandatory AskUserQuestion | ADOPT | Always use `question` tool for questions | DONE |

## 2) Hook Parity Matrix (17 upstream hooks)

Upstream hooks (Claude) -> OpenCode plugin equivalents.

| Upstream hook | Tag | OpenCode equivalent | Status |
|---|---|---|---|
| LoadContext.hook.ts | ADAPT | `context-loader.ts` via `experimental.chat.system.transform` | DONE |
| SecurityValidator.hook.ts | ADAPT | `security-validator.ts` via `tool.execute.before` | DONE |
| AutoWorkCreation.hook.ts | ADAPT | `work-tracker.ts` + `history-capture.ts` | DONE |
| SessionSummary.hook.ts | ADAPT | `work-tracker.ts` + `history-capture.ts` (event-driven finalize) | DONE (verified via session.deleted + META.yaml) |
| StopOrchestrator.hook.ts | ADAPT | OpenCode event lifecycle + deduped response capture | DONE (idle/deleted audit) |
| WorkCompletionLearning.hook.ts | ADAPT | `learning-capture.ts` on `session.deleted` | DONE |
| ResponseCapture.hook.ts | ADAPT | `history-capture.ts` captures THREAD + RAW | DONE |
| ISCValidator.hook.ts | ADAPT | Format gate requires non-empty ISC on FULL | DONE (empty criteria triggers rewrite) |
| ExplicitRatingCapture.hook.ts | ADAPT | `rating-capture.ts` + rating kiosk | DONE |
| ImplicitSentimentCapture.hook.ts | ADAPT | Heuristic-gated carrier inference to ratings.jsonl | IN_PROGRESS (implementation added; needs canary evidence) |
| AgentOutputCapture.hook.ts | ADAPT | `agent-capture.ts` for Task tool outputs | DONE |
| FormatReminder.hook.ts | ADAPT | `format-reminder.ts` + `prompt-hints.ts` + toast + artifacts | DONE |
| CheckVersion.hook.ts | ADAPT | Optional: plugin check vs repo version + toast | TODO/DEFER |
| StartupGreeting.hook.ts | ADAPT | Optional: plugin toast on session start | DEFER |
| QuestionAnswered.hook.ts | ADAPT | Optional: detect `question` tool completion | DEFER |
| UpdateTabTitle.hook.ts | DISCARD | OpenCode TUI does not use Kitty tabs | DISCARD |
| SetQuestionTab.hook.ts | DISCARD | OpenCode TUI does not use Kitty tabs | DISCARD |
| RelationshipMemory.hook.ts | ADAPT | Capture relationship notes to MEMORY/RELATIONSHIP | DONE (default-on; disable with env=0) |
| SoulEvolution.hook.ts | ADAPT | Queue soul updates to MEMORY/STATE (no auto-edit) | DONE (default-on; disable with env=0) |
| UpdateCounts.ts handler | ADAPT | Optional: maintain STATE counts (low ROI) | DEFER |
| SystemIntegrity.ts handler | ADAPT | Optional: periodic integrity checks | TODO/DEFER |
| VoiceNotification.ts handler | ADAPT | We already have voice_notify tool; tie to events if desired | PARTIAL |

Note: upstream lists 17 hooks; some additional handlers exist. We track them here for completeness.

## 3) Memory Parity Targets

| Upstream concept | Tag | OpenCode mapping | Status |
|---|---|---|---|
| Firehose transcript capture | ADAPT | `MEMORY/RAW` jsonl via history capture | DONE |
| Work sessions | ADAPT | `MEMORY/WORK/<YYYY-MM>/<sessionId>/` | DONE |
| Research capture | ADAPT | `MEMORY/RESEARCH/<YYYY-MM>/` | DONE |
| Explicit ratings | ADAPT | `MEMORY/LEARNING/SIGNALS/ratings.jsonl` | DONE |
| Implicit sentiment | ADAPT | Add `source: implicit` entries in `ratings.jsonl` | IN_PROGRESS |

## 4) Structural/Installer Parity

| Upstream change | Tag | OpenCode mapping | Status |
|---|---|---|---|
| CORE -> PAI rename | ADAPT | We keep CORE as canonical; document divergence | TODO (decision + doc) |
| INSTALL.md / INSTALL.ts | ADAPT | `Tools/Install.ts` + `PAIOpenCodeWizard.ts` | PARTIAL (audit) |
| Settings template updates | ADAPT | `.opencode/config` + wizard outputs | PARTIAL (audit) |
| Observability dashboard | OPTIONAL | Potential separate OpenCode web UI | PENDING (Petteri decision) |
| Statusline scripts | DISCARD | Claude/Kitty oriented | DISCARD |
