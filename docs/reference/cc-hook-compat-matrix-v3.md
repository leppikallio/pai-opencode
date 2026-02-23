# CC Hook Compatibility Matrix (PAI v3.0 → OpenCode PAI)

**Purpose:** A reusable, source-grounded compatibility matrix for migrating the Claude Code PAI v3.0 hook set into OpenCode + PAI **without monolith hooks**.

**Sources (read-only):**
- CC PAI v3.0 hooks: `/Users/zuul/Projects/ti2/Personal_AI_Infrastructure/Releases/v3.0/.claude/hooks/*.hook.ts`
- OpenCode upstream reference: `/Users/zuul/Projects/opencode`
- OpenCode PAI repo: `/Users/zuul/Projects/pai-opencode`

## Environment + constraints (OpenCode PAI)

- **Runtime root:** `~/.config/opencode/` (this is where hooks execute).
- **PAI_DIR:** treat as **literal runtime root** (do not depend on `${PAI_DIR}` expansion).
- **Memory firehose:** OpenCode PAI uses `~/.config/opencode/MEMORY/RAW/` as source of truth (vs CC transcript harvesting).
- **No monolith:** do not re-create `pai-unified.ts`-style orchestration inside one hook. Split responsibilities.

## Legend

- **KEEP**: port with minimal path/payload fixes; keep semantics.
- **ADAPT**: keep intent, but change implementation to OpenCode’s data sources and runtime.
- **REPLACE**: CC-specific coupling or unwanted behavior; implement a new OpenCode-native module/hook.

## Systemic deltas to watch (applies to multiple hooks)

1) **`transcript_path` dependency:** many v3 hooks parse transcripts; OpenCode PAI prefers `MEMORY/RAW` and may not provide `transcript_path`.
2) **Tool args plumbing:** OpenCode plugin provides `tool.execute.before` args via `output.args` (not `input.args`). Until fixed, `tool_input` can be empty.
3) **Terminal control:** v3 hooks assume Kitty and a local voice server (`localhost:8888`). Target direction is likely **cmux** (`/Users/zuul/Projects/cmux`).
4) **TaskCreate/TaskUpdate:** CC hooks expect these; OpenCode uses `todowrite`. We already adopted `TodoWrite` in our OpenCode tracker.

---

## Hook-by-hook matrix (v3.0)

| Hook file | CC trigger (event → matcher) | Key inputs (stdin/env) | Key outputs | Side effects (writes) | OpenCode parity risk | Recommendation |
|---|---|---|---|---|---|---|
| `SecurityValidator.hook.ts` | PreToolUse → Bash/Edit/Write/Read | `tool_input.command` (bash) / `file_path` (edit/write/read), `session_id` | JSON: `{continue:true}` or `{decision:"ask"}`; hard-block via `exit(2)` | `MEMORY/SECURITY/YYYY/MM/*.jsonl` | **High** until PreToolUse args plumbing is correct; also needs “ask” UX bridge | **KEEP (with adapter fixes)** |
| `VoiceGate.hook.ts` | PreToolUse → Bash | `tool_input.command`, `session_id` | JSON decision (`block` or continue) | reads `MEMORY/STATE/kitty-sessions/*` | Medium: main-session detection is terminal-specific; may change under cmux | **ADAPT** (cmux/main-session concept) |
| `AgentExecutionGuard.hook.ts` | PreToolUse → Task | expects `tool_input.run_in_background`, `subagent_type`, `model`, `prompt` | stdout `<system-reminder>...` (text), no blocking | none | **High**: OpenCode Task tool doesn’t expose `run_in_background`; also output should be JSON/systemMessage not raw XML | **ADAPT / REPLACE** (OpenCode-native background semantics) |
| `SkillGuard.hook.ts` | PreToolUse → Skill | `tool_input.skill` | JSON: `{decision:"block"}` (currently uses `decision:"block"`) | none | Medium: requires correct Skill tool_input mapping | **KEEP** (small deterministic) |
| `SetQuestionTab.hook.ts` | PreToolUse → AskUserQuestion | `tool_input.questions[0].header` + `session_id` | none | Kitty tab state (remote control) | **High** coupling to Kitty and tab state store | **REPLACE** (cmux UI module) |
| `QuestionAnswered.hook.ts` | PostToolUse → AskUserQuestion | `session_id` (+ tool result) | none | Kitty tab state | High Kitty coupling | **REPLACE** (cmux UI module) |
| `UpdateTabTitle.hook.ts` | UserPromptSubmit | `prompt`, `session_id`, **expects `transcript_path`** | none (sets tab + voice) | Kitty tab, voice notify (`localhost:8888/notify`) | High: Kitty + voice + transcript assumptions | **REPLACE** (cmux + OpenCode-native voice) |
| `StartupGreeting.hook.ts` | SessionStart | env: `COLUMNS`, `KITTY_*`; optionally stdin `session_id` | stdout banner | writes kitty env state under `MEMORY/STATE` | Medium: banner can be kept; Kitty persistence needs cmux alternative | **ADAPT** (banner keep, terminal control swap) |
| `LoadContext.hook.ts` | SessionStart | `PAI_DIR`, `TIME_ZONE`; reads multiple skill/rules files | stdout `<system-reminder>` with large context | none (mostly reads) | **High**: OpenCode already has system prompt + skill loading; duplicating may bloat/loop | **REPLACE / DROP** (OpenCode-native context system) |
| `CheckVersion.hook.ts` | SessionStart | runs `claude --version` + `npm view ...` | stderr notification | none | **High irrelevance**: Claude Code-specific | **DROP** |
| `AutoWorkCreation.hook.ts` | UserPromptSubmit | `session_id`, `prompt` | none | Creates `MEMORY/WORK/...` directory tree + `current-work-<sid>.json` | **High**: OpenCode PAI work tracking differs (RAW-first) | **REPLACE** (OpenCode work tracker) |
| `RatingCapture.hook.ts` | UserPromptSubmit | `prompt`, **expects `transcript_path`** | stdout injects algorithm reminder; writes rating signals | `MEMORY/LEARNING/SIGNALS/ratings.jsonl` + low-rating learnings | **High**: contains algorithm reminder injection + implicit sentiment inference; you explicitly don’t want kiosks/loops | **REPLACE** (OpenCode PAI rating capture, explicit-only gate) |
| `SessionAutoName.hook.ts` | UserPromptSubmit | `session_id`, `prompt`; reads `projects/**/sessions-index.json` | none | writes `MEMORY/STATE/session-names.json` | Medium: “projects/ sessions-index” is CC-specific | **ADAPT** (name source + storage) |
| `AlgorithmTracker.hook.ts` | PostToolUse → Bash/TaskCreate/TaskUpdate/Task | expects `TaskCreate/TaskUpdate` + voice-curl phase detection | JSON `{continue:true}`; updates algo state + tab | writes algorithm state under `MEMORY/STATE` | Medium: we already replaced this with TodoWrite-aware OpenCode tracker | **REPLACE** (use current OpenCode tracker) |
| `StopOrchestrator.hook.ts` | Stop | **requires `transcript_path`** | none | runs multiple handlers (voice/tab/skill rebuild/doc integrity) | **High**: transcript-first orchestration; very CC/Kitty-specific | **REPLACE** (modular OpenCode stop handlers) |
| `WorkCompletionLearning.hook.ts` | SessionEnd | `session_id`; reads `current-work-<sid>.json` + `WORK/*/META.yaml` | none | creates `MEMORY/LEARNING/{SYSTEM|ALGORITHM}/YYYY-MM/*.md` | Medium: learning intent is good; depends on CC work structure | **ADAPT / REPLACE** (OpenCode RAW/WORK projections) |
| `SessionSummary.hook.ts` | SessionEnd | `session_id`; reads `current-work-<sid>.json` | none | updates `WORK/*/META.yaml`; deletes `current-work*.json`; resets Kitty tab | High: Kitty + CC work structure | **ADAPT / REPLACE** (OpenCode work finalization + cmux reset) |
| `UpdateCounts.hook.ts` | SessionEnd | none | none | updates settings counts; does API cache refresh | Medium: likely irrelevant or already handled elsewhere | **DROP / REPLACE** (OpenCode stats) |
| `IntegrityCheck.hook.ts` | SessionEnd | **requires `transcript_path`** | none | runs integrity handlers (doc refs/system drift) | Medium: integrity intent useful; transcript dependency problematic | **ADAPT** (RAW-first integrity) |
| `RelationshipMemory.hook.ts` | Stop | `session_id`, **transcript_path** | none | appends `MEMORY/RELATIONSHIP/YYYY-MM/YYYY-MM-DD.md` | Medium: valuable, but transcript dependency; should use RAW events | **ADAPT** (RAW-based extraction) |

---

## Immediate follow-ups implied by the matrix (ordered)

1) Fix PreToolUse tool_input plumbing (OpenCode `tool.execute.before` args are in output).
2) Decide transcript strategy:
   - either generate a transcript-like JSONL path from RAW for hook compatibility
   - or adapt transcript-dependent hooks to consume RAW directly.
3) Decide terminal control strategy (Kitty vs **cmux**), then replace UI hooks accordingly.
4) Resolve AgentExecutionGuard semantics in OpenCode (what “background” means; what can be enforced).
