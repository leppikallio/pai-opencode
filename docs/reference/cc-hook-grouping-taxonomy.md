# CC Hook Grouping Taxonomy (PAI v3.0 → OpenCode PAI)

**Purpose:** A reusable decision framework for (1) **migration sequencing** and (2) **implementation ownership** when porting CC PAI v3.0 hooks into OpenCode PAI.

This taxonomy is explicitly designed to avoid:
- monolith hooks
- infinite-loop / self-triggering behavior
- tight coupling to Kitty / CC transcripts

## Inputs

- Compatibility matrix (source-of-truth): `docs/reference/cc-hook-compat-matrix-v3.md`
- OpenCode runtime reality:
  - runtime root is `~/.config/opencode/`
  - OpenCode PAI is **RAW-first** (`~/.config/opencode/MEMORY/RAW/`), not transcript-harvest-first

## Core idea

For each hook, decide **where it belongs** and **when to ship it**.

### Ownership buckets (where logic lives)

Use these buckets instead of “keep/adapt/replace” alone:

1) **KEEP-HOOK**
   - Keep as a hook script.
   - Only small edits (paths/payload/JSON output) allowed.

2) **ADAPT-HOOK**
   - Still a hook script, but modify input/output expectations to match OpenCode.
   - No cross-cutting orchestration.

3) **ADAPT-PLUGIN**
   - Keep the hook as a thin wrapper; move real logic into a plugin/shared TS module.
   - Use this when the hook needs OpenCode event semantics, caching, or RAW access.

4) **REPLACE-PLUGIN**
   - Do not port CC hook behavior.
   - Implement OpenCode-native behavior in a plugin module.

5) **REPLACE-TERMINAL (pending cmux)**
   - Terminal UX hooks (tab state, titles, colors, voice gating) should not depend on Kitty.
   - Implement via the chosen terminal control layer.
   - **Do not design this here**; treat it as blocked by the “cmux direction” investigation.

6) **DROP**
   - CC-specific or redundant in OpenCode PAI.

### Rollout buckets (when to ship)

- **P0 (safe canary):** non-blocking, deterministic, no heavy I/O
- **P1 (moderate):** writes bounded state; non-blocking
- **P2 (high risk):** enforcement that can deny/ask, or expensive processing

## Scoring rubric (avoid vibe-based decisions)

Score each hook 1–5 on:

| Factor | 1 (low) | 3 (medium) | 5 (high) |
|---|---:|---:|---:|
| Coupling | no external deps | mild runtime assumptions | Kitty/voice/transcript coupling |
| Input mismatch | OpenCode already supplies fields | minor adapter translation | requires transcript_path / CC-only tool schema |
| Blocking risk | never blocks | can ask/warn | can hard-block / exit nonzero |
| Value | cosmetic | helpful | core safety / core memory |
| Replacement cost | trivial | moderate | expensive + cross-system |

Decision rules (defaults):
- If **Coupling ≥ 4** to Kitty/voice → **REPLACE-TERMINAL**.
- If **Input mismatch ≥ 4** due to transcript_path → **ADAPT-PLUGIN** (RAW-first) or **REPLACE-PLUGIN**.
- If **Blocking risk ≥ 4** → ship as **P2** with `warn → ask → enforce` staging.

## Final grouping (for implementation orchestration)

This table is the **current final classification** used to plan and delegate work. Some items are marked **BLOCKED** where they depend on another master-plan decision.

**Cross-cutting prerequisite:** enforcement hooks (SecurityValidator/AgentExecutionGuard/SkillGuard) require correct `PreToolUse` tool_input plumbing in the plugin adapter.

| Hook | Ownership bucket | Rollout | Blocked by | Why |
|---|---|---|---|---|
| SecurityValidator | KEEP-HOOK (after adapter fixes) | P2 | tool_input plumbing; ask/confirm bridge | High value + blocking; needs correct `tool_input` + ability to “ask” |
| SkillGuard | KEEP-HOOK (after adapter fixes) | P0 | tool_input plumbing | Deterministic, low coupling |
| VoiceGate | REPLACE-TERMINAL (cmux) | P1 | cmux adapter contract | Main-session detection + voice suppression should live in terminal UX layer |
| AgentExecutionGuard | ADAPT-PLUGIN (port oh-my delegate_task) | P2 | none (tool strategy decided) | OpenCode built-in `task` is synchronous; parity needs plugin-defined background tool |
| SetQuestionTab | REPLACE-TERMINAL (cmux) | P1 | cmux adapter contract | Kitty-only tab control |
| QuestionAnswered | REPLACE-TERMINAL (cmux) | P1 | cmux adapter contract | Kitty-only tab control |
| UpdateTabTitle | REPLACE-TERMINAL (cmux) | P1 | cmux adapter contract; transcript strategy (optional) | Kitty + voice coupling; cmux is target UX |
| StartupGreeting | ADAPT-HOOK (banner only) + REPLACE-TERMINAL (cmux) | P0 | cmux adapter contract (terminal state) | Keep the greeting text; move terminal state/metadata to cmux |
| LoadContext | DROP (use opencode.json instructions) | P0 | none | OpenCode native `instructions` already handles context injection |
| CheckVersion | DROP | P0 | none | Claude Code CLI/npm specific |
| AutoWorkCreation | REPLACE-PLUGIN | P1 | transcript strategy (work model) | CC work-dir model differs; OpenCode should project work from RAW |
| RatingCapture | REPLACE-PLUGIN | P2 | transcript strategy (explicit-only rating) | CC version injects reminders + inference; we want safe, explicit capture |
| SessionAutoName | ADAPT-PLUGIN | P1 | none | Rename source (no CC sessions-index); derive from UserPromptSubmit/RAW |
| AlgorithmTracker | REPLACE-PLUGIN (use existing OpenCode tracker) | P1 | none | CC expects TaskCreate/TaskUpdate; OpenCode uses TodoWrite |
| StopOrchestrator | REPLACE-PLUGIN | P2 | transcript strategy | CC transcript-first orchestration is too coupled; split into modular handlers |
| WorkCompletionLearning | ADAPT-PLUGIN / REPLACE-PLUGIN | P2 | transcript strategy | Valuable, but must operate on OpenCode projections (RAW/work artifacts) |
| SessionSummary | ADAPT-PLUGIN + REPLACE-TERMINAL (cmux cleanup) | P2 | transcript strategy; cmux adapter contract | Work finalization differs + terminal reset |
| UpdateCounts | DROP | P0 | none | Out of scope |
| IntegrityCheck | ADAPT-PLUGIN | P1 | transcript strategy | Intent good; should be RAW-first |
| RelationshipMemory | ADAPT-PLUGIN | P1 | transcript strategy | Valuable; should be RAW-first |

## Rollout sequencing (recommended)

### Phase A — Foundations (unblock everything)
- Fix `PreToolUse` tool_input plumbing in the plugin adapter (so hooks see real args)
- Add/verify ask/confirm bridge for hooks that return `decision:"ask"`

### Phase B — P0 canary (low risk)
- SkillGuard (once tool_input plumbing is correct)
- StartupGreeting banner-only (cmux bits no-op until cmux contract exists)
- Drop LoadContext/CheckVersion/UpdateCounts in CC-hook parity config

### Phase C — Background agents parity (P2, high value)
- Port oh-my-opencode `delegate_task` + `BackgroundManager` approach into PAI plugin
  - Tool naming decision: expose as tool id **`task`** (override builtin) with `run_in_background`.
- Update AgentExecutionGuard to enforce/background-route via the new tool

### Phase D — Transcript strategy (DECIDED; unblocks many ADAPT-PLUGIN hooks)
- Decision: **RAW-first**.
  - Adapt/replace transcript-dependent hooks to consume RAW (or RAW-derived projections) directly.
  - Explicit non-goal: do **not** build a global “RAW → Claude transcript.jsonl” compatibility layer just to provide `transcript_path`.

### Phase E — cmux terminal UX contract (unblocks REPLACE-TERMINAL hooks)
- Define cmux adapter contract (status/progress/sidebar/notify, debouncing, session→workspace mapping)
- Replace Kitty-coupled hooks with cmux-backed equivalents

## Remaining open decisions (keep minimal; avoid rework)

1) **Transcript strategy (DECIDED)**
   - RAW-first: rewrite/adapt transcript-dependent hooks to consume RAW (or projections) directly.

2) **cmux adapter contract (DECIDED)**
   - Decided: socket-first (v2 JSON) + env-var targeting + debounce/throttle.
   - Mapping fallback: persist session_id → workspace/surface in `~/.cmuxterm/opencode-hook-sessions.json` when env vars exist.
   - Reference: `docs/reference/cmux-capability-map.md`

3) **AgentExecutionGuard (DECIDED)**
   - Decided: background-capable tool id `task` (plugin override) with `run_in_background`.
   - Decided: ASK thresholds + completion surface (cmux + voice) + dedupe policy.
   - Reference: `docs/reference/opencode-background-agents-and-guard.md`
