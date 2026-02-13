# Deep Research for OpenCode — Product Roadmap (Refactor + Rebuild)

## 1) Problem framing

### What’s broken today (symptoms)
- **Context exhaustion**: research runs accumulate raw outputs + orchestration text until synthesis quality collapses or compaction triggers mid-flight.
- **Quality + coverage drift**: inconsistent breadth, duplicate sourcing, missing platforms/perspectives, and weak “did we actually answer the question?” checks.
- **Silent hangs**: long-running subagents or tool calls stall with poor progress visibility and weak timeboxing.
- **Citations aren’t doing their job**: too many gathered, too few used; URLs can be hallucinated or unverifiable.
- **Tool hierarchy correctness**: researchers substitute tools, bypass intended primary tools, or “succeed” with off-mission retrieval.

### Root causes (architectural)
- Orchestration is mostly *promptware* (large instructions) instead of a **state machine with gates**.
- Raw evidence isn’t treated as a **first-class artifact pack**; it gets pushed back into the model context.
- Quality control is bolted on late instead of being **progressive gates** between phases.
- Tool access isn’t enforced strongly enough at the right layer (agent/tool/server).

### Target user outcomes (what “Deep Research” should feel like)
- You run one command (or workflow) and get a **publishable report** with:
  - **explicit methodology**, **coverage accounting**, and **confidence levels**
  - **verified citations** (and flagged unverifiable ones)
  - **reproducible artifacts** saved to a session directory
- The system:
  - **does not silently hang**
  - **adapts** (2-wave or iterative) when coverage is insufficient
  - **stays within context budgets** by design (not by luck)

---

## 2) Evidence-based constraints from current codebase (what we must build with)

### OpenCode session/compaction realities
- OpenCode triggers compaction when tokens exceed a usable budget; this is a safety net, not a research workflow strategy.  
  - Evidence: `/Users/zuul/Projects/opencode/packages/opencode/src/session/compaction.ts` (e.g., `COMPACTION_BUFFER`, `isOverflow`, `prune`)
- Tool outputs can be **pruned** to control token load; relying on “the chat transcript is the archive” will fail for deep research.  
  - Evidence: `/Users/zuul/Projects/opencode/packages/opencode/src/session/compaction.ts` (`prune`, `PRUNE_PROTECTED_TOOLS`)

### Subagent context + scratchpad bindings exist (use them)
- The PAI/OpenCode plugin binds a per-session scratchpad and enforces minimal subagent mode (good for reducing context pollution).  
  - Evidence: `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/plugins/pai-unified.ts` (scratchpad binding + “PAI SUBAGENT MODE”)

### Research-shell MCP is already a strong foundation (enforce tools, capture evidence)
- research-shell tools require `session_dir` and perform evidence + artifact capture; it also supports agent-type tool restrictions (H7) and retries/timeouts.  
  - Evidence:  
    - `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/mcp/research-shell/index.ts` (tool schemas, `session_dir`, H7 allowlist, evidence/artifact records)  
    - `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/mcp/research-shell/retry.ts` (retry/backoff)  
    - `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/mcp/research-shell/config.ts` (explicit timeouts + env-driven config)
- Citation formatting + URL extraction helpers already exist; we should build on them.  
  - Evidence: `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/mcp/research-shell/prompts.ts`, `RedirectResolver.ts`

### The legacy stack has the right *shape* (multi-phase, gates, wave pivots), but is prompt-heavy
- The legacy “adaptive multi-wave” design explicitly calls out context efficiency and phased gating.  
  - Evidence: `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/conduct-research-adaptive.md`
- It includes perspective-first planning, 2-wave pivots, platform coverage checks, source quality gates, and missed-coverage detection.  
  - Evidence:  
    - `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-init.md`  
    - `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/utilities/quality-analyzer/pivot-decision-engine.ts`  
    - `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/utilities/quality-analyzer/platform-coverage-validator.ts`  
    - `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/utilities/query-analyzer/source-tiers/quality-gate.ts`

---

## 3) Product scope boundaries (V1)

### V1 should do
- Provide a **single, repeatable Deep Research workflow** inside OpenCode:
  - Session directory creation + artifact capture
  - Wave 1 research (multi-angle, multi-source)
  - Automated compression (summaries + claim/citation extraction)
  - Progressive quality gates + pivot decision
  - Optional Wave 2 targeted fill
  - Synthesis from **compressed pack** (not raw dumps)
  - Citation verification + utilization reporting
  - Final report with: executive summary, methodology, findings, uncertainties, references, and metrics
- Enforce tool hierarchy:
  - Researchers use **research-shell MCP** as primary (tool-locked by agent type).
  - Escalation (BrightData/Apify) is orchestrator-controlled, not ad-hoc in each researcher.

### V1 should NOT do
- Full semantic “claim-to-source line-level” verification across every sentence (too expensive/complex for V1).
- A vector database / long-term knowledge graph.
- Fully automated paywall bypassing or proprietary content extraction beyond configured tools.
- A new UI (CLI-only / chat-only is fine for V1; observability can be file-based).

---

## 4) Three roadmap options

### Option A — Conservative (2–3 weeks): “Deep Research as a Workflow Doc + Light Utilities”
**What you build**
- Add a new OpenCode command/workflow that orchestrates a fixed multi-agent run (Wave 1 only or minimal pivot).
- Use research-shell for evidence capture; basic URL verification; simple synthesis.

**Pros**
- Fastest to ship; leverages existing researcher agents immediately.

**Cons**
- Still too prompt-driven; context exhaustion likely returns on bigger runs.
- Progressive gates will be weaker (manual-ish).

---

### Option B — Balanced (6–8 weeks): “Artifact-first Deep Research State Machine” **(Recommended)**
**What you build**
- Deep Research becomes an **artifact-first, gated pipeline** with a small orchestration prompt and real code utilities:
  - session state (`research-state.json`)
  - evidence index + citation pool
  - compression pack for synthesis (bounded size)
  - pivot engine for Wave 2
  - reliability timeboxing + progress logging

**Pros**
- Directly targets the pain points: context exhaustion, coverage, hangs, citations, tool hierarchy.
- Doesn’t require rewriting OpenCode core; fits the PAI/OpenCode integration model.

**Cons**
- Moderate engineering effort; requires disciplined schema decisions early.

---

### Option C — Ambitious (12–16 weeks): “First-class Deep Research Tooling in OpenCode”
**What you build**
- Implement Deep Research as a **first-class tool/plugin-driven orchestrator** (less LLM-controlled sequencing):
  - programmatic stage machine, cancellations, watchdog timers
  - UI/telemetry hooks
  - caching/dedup and optional long-term store

**Pros**
- Maximum reliability and determinism; best long-term “product” feel.

**Cons**
- Requires deeper OpenCode core/plugin work and higher integration risk.

---

## 5) Recommended option: **Balanced (Option B)**

### Rationale
- It’s the smallest option that **structurally** solves the key pain: **context exhaustion** (by never pushing raw evidence back into the model).
- It uses existing assets that already enforce correctness:
  - research-shell’s `session_dir` evidence capture and tool restrictions
  - OpenCode’s command/agent system
  - PAI scratchpad bindings for safe artifact storage
- It creates a foundation where Option C becomes an incremental evolution instead of a rewrite.

---

## 6) Proposed V1 architecture (Option B)

### A. Session artifact pack (the core anti-context-exhaustion move)
Create a single session directory under the bound scratchpad with:
- `research-state.json` — canonical pipeline state and phase markers
- `plan.json` — perspectives, tracks, expected platforms, budgets
- `wave1/` and `wave2/` — raw provider outputs (already captured by research-shell artifacts too)
- `evidence/` — research-shell JSON/MD artifacts + JSONL evidence log
- `compression/`
  - `findings.jsonl` (atomic claims + citations + source)
  - `summaries.md` (bounded, per-angle summaries)
  - `citation-pool.json` (deduped, resolved URLs, status)
- `report.md` — final output

(You already have the concept of session-dir artifact capture in research-shell.)  
- Evidence: `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/mcp/research-shell/index.ts` (`ArtifactRecord`, `EvidenceEntry`, `session_dir` requirement)

### B. Context budgeting rules (hard limits)
- **Never** feed raw wave outputs to the synthesis step.
- Synthesis input must be a **bounded “compression pack”**:
  - max N tokens/KB for summaries
  - top-K citations per theme
  - “must-include” citations for critical claims
- If pack exceeds budget: re-run compression with stricter pruning (not compaction roulette).

### C. Progressive quality gates (phase-by-phase)
Gates are binary checks recorded in `research-state.json` (and optionally marker files):
1. **Plan gate**: perspectives + budgets generated
2. **Wave 1 gate**: all planned angles executed or explicitly failed with reason
3. **Compression gate**: summaries + findings.jsonl produced and within budget
4. **Pivot gate**: coverage/quality decision computed
5. **Wave 2 gate** (conditional): gap-fill completed
6. **Citation gate**: URL status checks + redirect resolution + invalid list
7. **Synthesis gate**: report structure complete + utilization metrics computed

(Your legacy design already uses explicit phase gates; we refactor the concept into a lightweight, file-first state machine.)  
- Evidence: legacy phase gating approach in `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-collect.md` and `/conduct-research-adaptive.md`

---

## 7) Milestone plan (Option B)

> Durations assume 1 engineer (with occasional QA time). If you parallelize, compress timeline.

### Phase 0 — Decisions + design (1 week)
**Deliverables**
- Finalize schemas: `research-state.json`, `findings.jsonl`, `citation-pool.json`
- Decide command surface: `/deep-research` (OpenCode command) vs skill workflow vs pipeline action
- Decide budgets (KB/token caps) by mode: quick/standard/deep

**Dependencies**
- Agreement on where artifacts live (must be under scratchpad bindings).

---

### Phase 1 — Skeleton orchestration (1–2 weeks)
**Deliverables**
- Command that:
  - creates session dir
  - runs Wave 1 (multi-angle) via existing researcher agents + research-shell tools
  - persists all outputs to disk
- Minimal progress logging and “no silent hang” timeboxing at stage level (wall-clock budgets)

**Dependencies**
- research-shell configured and usable.

---

### Phase 2 — Compression pack (1–2 weeks) *(context exhaustion work)*
**Deliverables**
- Implement compression pipeline:
  - per-angle summary (bounded)
  - extraction of atomic findings with citations into JSONL
  - dedup + merge of citations into a pool
- Enforce hard size budgets; fail loudly if exceeded, then auto-recompress tighter.

**Dependencies**
- Stable output format from researchers (or robust parsers).

---

### Phase 3 — Progressive quality + pivot engine (1–2 weeks)
**Deliverables**
- Implement pivot decision based on:
  - quality scoring
  - domain signal detection
  - coverage gap analysis
  - platform coverage gaps
  - source quality balance
  - missed coverage detection
- Wave 2 planner: generate “gap-fill” angles + agent selection

(Refactor concepts, do not copy monolith.)  
- Evidence for decision components: `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/utilities/quality-analyzer/pivot-decision-engine.ts`

---

### Phase 4 — Citation verification + utilization (1 week)
**Deliverables**
- URL verification pipeline:
  - redirect resolution + canonicalization
  - status checks (200/blocked/paywall)
  - verify “content exists” for a priority subset (top citations)
- Compute utilization:
  - citations collected vs citations referenced in report
  - warning if utilization drops below threshold

**Dependencies**
- Redirect/citation helpers in research-shell (already exist).  
  - Evidence: `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/mcp/research-shell/RedirectResolver.ts`, `prompts.ts`

---

### Phase 5 — Reliability + observability hardening (1 week)
**Deliverables**
- “Never silent hang” contract:
  - per-stage max duration
  - retries only where safe (MCP already retries; orchestrator should not infinitely respawn)
  - explicit failure modes recorded in state + surfaced in report
- File-based run summary:
  - timings, errors, coverage metrics, tool usage, cost estimates (if available)

**Dependencies**
- OpenCode command integration + stable session directory rules.

---

### Phase 6 — QA + acceptance suite (3–5 days)
**Deliverables**
- A small corpus of standardized research prompts with expected metrics:
  - citation validity thresholds
  - coverage thresholds
  - max artifact sizes
  - report structure checks

---

## 8) KPI / acceptance metrics (V1)

### Quality
- **Citation validity**: ≥ 95% of included URLs return 200 or are explicitly flagged (paywall/blocked).
- **Claim grounding**: 0 uncited numeric/statistical claims in “Findings” section (or they must be marked `[UNVERIFIED]`).
- **Report completeness**: required sections present (Exec Summary, Methodology, Findings, Uncertainties, References).

### Coverage
- **Perspective execution rate**: ≥ 90% of planned angles executed or explicitly failed with reason.
- **Platform coverage**: ≥ 80% of “expected platforms” hit when required by the plan (otherwise triggers Wave 2 fill).

### Cost
- **Cost ceiling per mode** (define per provider):
  - Standard: capped (e.g., 3–6 calls total)
  - Deep: capped (e.g., 9–15 calls total)
- **Waste metric**: citations collected but unused ≤ 40% (target improves over time).

### Latency
- Standard deep research end-to-end: **≤ 6 minutes** (with explicit partial-results output if timeboxed).
- No single tool call exceeds configured timeout (MCP-level timeouts enforced; see config).

### Reliability
- **No silent hangs**: every phase emits progress and either completes or fails within the phase budget.
- **Retry discipline**: max 1 orchestrator-level retry per failed phase; MCP retries remain as-is.

---

## 9) Risk register + mitigations

### R1 — Context exhaustion returns via “compression creep”
- **Risk**: summaries grow; synthesis input bloats again.
- **Mitigation**: hard budgets + auto-recompression; keep compression pack schema minimal.

### R2 — Tool substitution breaks hierarchy
- **Risk**: researchers fall back to websearch/webfetch and report success.
- **Mitigation**: enforce primary tools via research-shell (H7) and tighten agent permissions for deep-research mode; orchestrator controls escalation.

### R3 — Citation verification is expensive/slow
- **Risk**: verifying every URL deeply increases latency.
- **Mitigation**: tiered verification:
  - always: status + redirect resolution
  - priority subset: content confirmation for citations used in final report

### R4 — Paywalls / blocks reduce validity
- **Risk**: lots of “unverifiable” sources.
- **Mitigation**: progressive retrieval escalation (BrightData/Apify) *only when needed*; report unverifiable rates clearly.

### R5 — Rate limits and transient API failures
- **Risk**: partial runs, inconsistent results.
- **Mitigation**: rely on MCP retry/backoff + orchestrator timeboxing; record which angles failed and trigger Wave 2 reroutes only when justified.

### R6 — Overfitting to one research provider’s formatting
- **Risk**: parsing breaks; citations extraction unreliable.
- **Mitigation**: normalize into internal schema early (findings.jsonl + citation pool), treating provider output as raw text.

---

## 10) Decision log (must resolve early)

1. **Surface area**: Is V1 invoked via an OpenCode **command** (`.opencode/commands/...`) or a **skill workflow**, or both?
2. **Session directory canonical location**: choose one root under the PAI scratchpad binding and pass it everywhere (including `session_dir` for research-shell tools).
3. **Compression pack budget rules**: define exact limits per mode (KB/tokens + top-K citations per theme).
4. **Pivot thresholds**: what triggers Wave 2 (coverage gaps, source imbalance, platform gaps, low quality)?
5. **Citation verification level**: status-only vs content-check for a priority subset (recommended).
6. **Tool escalation policy**: when to use BrightData/Apify and who is allowed to call them (recommended: orchestrator-only).
7. **AGENT_TYPE mapping for research-shell H7**: ensure the runtime sets agent type consistently with the allowlist (or document the dev-mode behavior).

---

## 11) How the roadmap explicitly solves context exhaustion + progressive quality gates

### Context exhaustion (by design, not hope)
- Artifact-first: raw evidence is written to disk and treated as the source of truth.
- Synthesis consumes only a bounded compression pack (summaries + findings JSONL + curated citations).
- Compaction becomes a last-resort safety net rather than a normal operating mode.  
  - Evidence: OpenCode compaction behavior in `/Users/zuul/Projects/opencode/packages/opencode/src/session/compaction.ts`

### Progressive quality gates (continuous correctness)
- Every phase produces verifiable artifacts + a gate decision recorded in state.
- Gates determine whether to:
  - proceed,
  - pivot (Wave 2),
  - recompress,
  - or fail loudly with a diagnosable reason.
- This prevents “big bang synthesis” from being the first time you learn quality is bad.  
  - Evidence: legacy gated phases in `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-collect.md`

---

## 12) Concrete files reviewed (evidence list)

### Legacy adaptive stack (reference shape; do not copy)
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/conduct-research-adaptive.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-init.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-collect.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-validate.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/utilities/query-analyzer/query-analyzer.ts`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/utilities/quality-analyzer/pivot-decision-engine.ts`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/utilities/quality-analyzer/platform-coverage-validator.ts`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/utilities/query-analyzer/source-tiers/quality-gate.ts`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/skills/CitationValidation/SKILL.md`

### OpenCode core (context overflow + orchestration mechanics)
- `/Users/zuul/Projects/opencode/packages/opencode/src/session/compaction.ts`
- `/Users/zuul/Projects/opencode/packages/opencode/src/session/prompt.ts`
- `/Users/zuul/Projects/opencode/packages/opencode/src/tool/task.ts`
- `/Users/zuul/Projects/opencode/packages/opencode/src/config/config.ts`

### PAI/OpenCode integration + existing research infrastructure
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/plugins/pai-unified.ts`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/skills/research/SKILL.md`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/skills/research/QuickReference.md`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/skills/research/Workflows/StandardResearch.md`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/skills/research/Workflows/ExtensiveResearch.md`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/mcp/research-shell/index.ts`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/mcp/research-shell/config.ts`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/mcp/research-shell/prompts.ts`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/mcp/research-shell/retry.ts`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/mcp/research-shell/RedirectResolver.ts`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/mcp/research-shell/PHASE8_CHANGES.md`

### Runtime researcher agents (keep leveraging)
- `/Users/zuul/.config/opencode/agents/researcher.md`
- `/Users/zuul/.config/opencode/agents/PerplexityResearcher.md`
- `/Users/zuul/.config/opencode/agents/GeminiResearcher.md`
- `/Users/zuul/.config/opencode/agents/GrokResearcher.md`
