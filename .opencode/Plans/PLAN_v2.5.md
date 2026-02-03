# PAI-OpenCode v2.4 -> v2.5 Port Plan (Full-Release Perspective)

This plan intentionally treats upstream v2.5.0 as a *large release*, not just the 3 headline Algorithm upgrades.

Canonical path (crash-safe): `.opencode/Plans/PLAN_v2.5.md`

---

## Plan Quality Gate (If any item fails, plan is invalid)

- I can execute the next step without guessing missing details.
- I can resume after a crash using only this file.
- Every work unit has a binary verification and evidence path.
- Required vs optional scope is explicit and enforced.

---

## Current State Snapshot (2026-02-02)

Upstream v2.5.0 (Claude Code) adds:
- 3 major Algorithm upgrades (two-pass selection, thinking tools opt-out, parallel-by-default)
- 7 composition patterns + mandatory AskUserQuestion
- Structural changes: CORE -> PAI, consolidated SKILL.md, INSTALL.ts/INSTALL.md, MEMORY structure update
- 17 hooks, 28 skills, 356 workflows (plus optional observability + voice server)

Our OpenCode port status (high-level):
- Implemented: two-pass semantics in PAI docs, format hints + prompt hints (toast + JSONL artifacts), explicit rating capture, agent output capture, work tracking, security validator
- Missing/partial: implicit sentiment capture, session summary/stop orchestrator parity audit, ISC hard-gating decision, installer/settings parity audit, CORE->PAI rename implementation

Repo evidence files:
- `.opencode/Plans/PortMap_v2.5.md` (hook parity matrix)
- `.opencode/Plans/Verification_v2.5.md` (verification checklist)

---

## Work Units (Executable + Resumable)

Status legend:
- PENDING / IN_PROGRESS / VERIFIED / DEFERRED / DISCARDED

WU01 (REQUIRED): Core Algorithm parity
- Goal: ensure v2.5 Algorithm requirements exist in PAI docs (two-pass, thinking tools justify-exclusion, parallel-by-default, composition patterns, AskUserQuestion).
- Repo targets: `.opencode/skills/PAI/SKILL.md`
- Verify: read `.opencode/skills/PAI/SKILL.md` and confirm all sections exist.
- Evidence: commit diff + the file itself.
- Status: VERIFIED

WU02 (REQUIRED): Hook parity mapping
- Goal: explicit ADOPT/ADAPT/DISCARD decision for each upstream hook.
- Repo targets: `.opencode/Plans/PortMap_v2.5.md`
- Verify: PortMap contains all upstream hooks listed in v2.5 notes.
- Evidence: `.opencode/Plans/PortMap_v2.5.md`
- Status: VERIFIED

WU03 (REQUIRED): Pass-1 hints parity (OpenCode constraints)
- Goal: implement Pass-1 “Hook Hints” as post-turn toasts + artifacts (OpenCode cannot inject same-turn system text).
- Repo targets: `.opencode/plugins/handlers/format-reminder.ts`, `.opencode/plugins/handlers/prompt-hints.ts`, `.opencode/plugins/handlers/history-capture.ts`, `.opencode/plugins/pai-unified.ts`
- Verify:
  - `FORMAT_HINTS.jsonl` exists under the current work dir
  - `PROMPT_HINTS.jsonl` exists under the current work dir
- Evidence: runtime files in `~/.config/opencode/MEMORY/WORK/<YYYY-MM>/<sessionId>/`
- Status: VERIFIED

WU04 (REQUIRED): ImplicitSentimentCapture parity
- Goal: write implicit sentiment ratings to `MEMORY/LEARNING/SIGNALS/ratings.jsonl` with `source: "implicit"`, without double-counting explicit ratings.
- Approach: heuristic-gated sentiment inference (async, non-blocking) using OpenCode server carrier.
- Repo targets: `.opencode/plugins/handlers/sentiment-capture.ts`, `.opencode/plugins/handlers/history-capture.ts`, `.opencode/plugins/handlers/rating-capture.ts`
- Verify:
  1) Send a “high-affect” message that is NOT an explicit rating.
  2) Confirm `~/.config/opencode/MEMORY/LEARNING/SIGNALS/ratings.jsonl` has an entry with `source:"implicit"`.
- Evidence: the JSONL line in runtime.
- Status: IN_PROGRESS

WU05 (REQUIRED-ish): StopOrchestrator/SessionSummary parity audit
- Goal: explicitly verify and, if needed, improve our idle/deleted lifecycle so it matches v2.5 intent (single parse point, deterministic finalize, no duplicates).
- Repo targets: `.opencode/plugins/handlers/history-capture.ts`, `.opencode/plugins/handlers/work-tracker.ts`, `.opencode/plugins/pai-unified.ts`
- Verify: one session produces exactly one completion event and stable work finalization.
- Evidence: RAW event log + work dir META/THREAD changes.
- Status: PENDING
 - Status: VERIFIED

WU06 (REQUIRED decision): ISC hard-gating policy
- Goal: decide whether we only warn (toast/thread) or hard-gate responses/actions on ISC failures.
- Constraint: OpenCode cannot block already-generated responses; hard-gating is only safe for tool actions (pre-tool).
 - Repo targets: `.opencode/Plans/PortMap_v2.5.md` (policy), `.opencode/plugins/handlers/isc-parser.ts` (if we implement a gate)
- Verify: policy documented + at least one test case.
- Evidence: docs + log of a gate/warn.
- Status: VERIFIED

WU07 (REQUIRED audit): Installer/settings parity audit
- Goal: compare upstream `INSTALL.ts`/`INSTALL.md` + settings template changes to our `Tools/Install.ts` + wizard and document gaps.
 - Repo targets: `.opencode/PAIOpenCodeWizard.ts`, `Tools/Install.ts`, `.opencode/Plans/PLAN_v2.5.md` (results)
- Verify: a checklist of upstream items marked ADOPT/ADAPT/DISCARD, with implementation pointers.
- Evidence: plan section update + references.
- Status: PENDING

WU08 (REQUIRED decision): CORE -> PAI rename parity
- Goal: rename CORE to PAI canonical, keep CORE alias for back-compat.
 - Repo targets: `.opencode/plugins/handlers/context-loader.ts`, `Tools/Install.ts`, `.opencode/Plans/PortMap_v2.5.md`
- Verify: PAI is canonical, CORE alias works, install migrates USER/WORK.
- Evidence: plan update + code changes + install log.
- Status: IN_PROGRESS

WU09 (OPTIONAL): Observability dashboard parity
- Goal: decide scope; likely deferred.
- Status: DEFERRED

WU10 (OPTIONAL): Voice server parity
- Goal: decide scope; likely deferred.
- Status: DEFERRED

---

## Resume Protocol (Crash-safe)

1) Open `.opencode/Plans/PLAN_v2.5.md` and read the Work Units section.
2) Resume at the first WU whose Status != VERIFIED/DEFERRED/DISCARDED.
3) For any WU in progress, run its Verify steps and attach evidence to:
   - `.opencode/Plans/Verification_v2.5.md` (add a dated entry)
4) If runtime evidence is needed, locate the session dir from OpenCode scratchpad directive:
   - `~/.config/opencode/MEMORY/WORK/<YYYY-MM>/ses_<id>/`

---

## Notes

Anything after Resume Protocol lives in `.opencode/Plans/PortMap_v2.5.md` and `.opencode/Plans/Verification_v2.5.md`.

OPTIONAL:
- Observability dashboard parity (decision pending)
- Voice server service parity (decision pending)
- RelationshipMemory / SoulEvolution parity (REQUIRED by Petteri)

---

## Decision Gates (Explicit Owner: Petteri)

D1: Observability dashboard
- Options: DEFER / PORT minimal / PORT full parity
- Default: DEFER until REQUIRED parity complete
- Why: upstream treats Observability as a full separate product surface.

D2: Voice server
- Note: already implemented in our OpenCode port.
- Action: treat as a post-REQUIRED parity audit item (not net-new build).

D3: RelationshipMemory + SoulEvolution
- Options: DEFER / PORT with explicit opt-in & redaction rules
- Default: DEFER (privacy-sensitive and hard to do safely).

## Current Status (Rolling)

**Last updated:** 2026-02-02

Completed (Core/Algorithm slice):
- Pass-1 format hints implemented (toast + `FORMAT_HINTS.jsonl`)
- Pass-1 prompt hints implemented (toast + `PROMPT_HINTS.jsonl`)
- PAI doc updated for two-pass + thinking tools + parallel-by-default + composition patterns
- Prompt hint carrier uses OpenCode server auth (no separate API key)

Completed (Partial hook parity):
- Security validator (OpenCode plugin)
- Explicit rating capture (OpenCode plugin)
- Agent output capture (OpenCode plugin)
- Work tracking + ISC capture (OpenCode plugin)

Not yet completed (Big remaining parity work):
- Full mapping of all 17 upstream hooks into ADOPT/ADAPT/DISCARD with status (DONE in PortMap)
- Implicit sentiment capture (upstream includes this as first-class)
- Session summary + stop orchestration parity (we approximate; needs explicit verification)
- “CORE -> PAI rename” parity implementation (in progress)
- Installer parity audit vs upstream INSTALL.md/INSTALL.ts

## Work Packages (Expanded)

WP-A: Expand PortMap to full-release scope
- Produce a full matrix mapping (done) and keep it updated:
  - 17 upstream hooks -> OpenCode plugin equivalents
  - memory system items -> OpenCode implementation points
  - install/settings items -> our installer/wizard

WP-B: Implement missing REQUIRED hook parities
- ImplicitSentimentCapture (OpenCode carrier-based inference)
- SessionSummary improvement (if needed)
- UpdateCounts/CheckVersion equivalents (if desired)

WP-C: Verification
- Canary evidence for all REQUIRED components

## Artifacts

- `.opencode/Plans/PLAN_v2.5.md` (this document)
- `.opencode/Plans/PortMap_v2.5.md` (full mapping matrix)
- `.opencode/Plans/Verification_v2.5.md` (verification checklist + evidence)
