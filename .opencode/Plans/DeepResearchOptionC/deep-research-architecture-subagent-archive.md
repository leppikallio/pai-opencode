# OpenCode-Native Adaptive Deep Research Refactor — Technical Implementation Plan

> **Scope:** Plan only (no code changes in this deliverable).  
> **Primary objective:** eliminate orchestration/synthesis context exhaustion while keeping research verifiable, stateful, and safe.  
> **Key constraint:** reuse existing OpenCode runtime researcher agents (ClaudeResearcher / PerplexityResearcher / GeminiResearcher / GrokResearcher / researcher), and OpenCode’s command + session model.

---

## 1) Target architecture (components + data flow + state)

### 1.1 Design principles (first-principles)
1. **Artifact-first, not prompt-first:** the orchestrator should *write/read bounded artifacts* instead of “holding the entire world in chat context”.
2. **Bounded interfaces between phases:** each phase must have a **hard output contract** (schema + max size) that the next phase consumes.
3. **Gates before expensive steps:** synthesis must be **blocked** unless citation validation and summary-pack creation are complete.
4. **Session-native state:** use OpenCode sessions + todos for progress, and a deterministic on-disk run directory under the active work scratch area.

### 1.2 Components (target system)
**A. Research Orchestrator (OpenCode slash command + session runner)**
- Role: lifecycle controller for a research run; creates run state; launches waves; enforces gates; produces final response.
- Form: implemented primarily as an OpenCode command (and/or a skill workflow) so it’s native to OpenCode’s UX and permission model.

**B. Run State Store (filesystem + session todos)**
- Filesystem: run directory containing manifests, wave outputs, summaries, citation pool, logs.
- Session todos: user-visible progress phases/subphases (OpenCode supports todos; see tools docs).

**C. Query Router (perspective + track allocator)**
- Input: user query + constraints (time sensitivity, requested depth).
- Output: a bounded list of “perspectives” (angles), each with:
  - recommended agent type (existing runtime agents),
  - a “track” policy (standard/independent/contrarian),
  - max tool budget and max output size.

**D. Wave Executor (fan-out)**
- Launches Wave 1 researchers in parallel (each gets one perspective).
- Runs Pivot Analyzer to decide if Wave 2 is needed.
- Launches Wave 2 specialists (optional) with gap-focused prompts.

**E. Citation Pipeline (validation + pool)**
- Extracts URLs from all wave outputs.
- Verifies URLs (availability + content relevance) and produces a **Validated Citation Pool**.
- Produces a hallucination/invalid-citation report per agent for observability.

**F. Summarization Pipeline (bounded “summary pack”)**
- Each raw researcher output is summarized into a bounded “Perspective Summary” artifact.
- These summaries form the *only* high-volume input to synthesis.

**G. Synthesis + Review Gate (producer/approver loop)**
- Synthesis writer creates final report using:
  - summary pack,
  - validated citation pool only,
  - run manifest (methodology).
- Reviewer/validator checks structure + citation density/utilization; may request revision (max iterations).

**H. Observability + Quality Gates**
- Logs to run dir + optional OpenCode `/log` endpoint.
- Gate metrics: coverage, citations validated %, utilization %, density, missing perspectives, run errors.

### 1.3 Data flow (end-to-end)
```text
User Query
  │
  ▼
[Init + Router] -> run.manifest.json + perspectives.json + todos
  │
  ▼
[Wave 1 Fan-out] -> wave-1/*.md (structured headers)
  │
  ▼
[Pivot Gate] -> pivot.json (launch wave2? specialists?)
  │
  ├── if yes
  │     ▼
  │   [Wave 2 Fan-out] -> wave-2/*.md
  │
  ▼
[Citation Validation Gate] -> citations.validated.jsonl + validated-citations.md + hallucinations.md
  │
  ▼
[Summarize Fan-out] -> summaries/*.md (bounded, 3–5KB each)
  │
  ▼
[Synthesize] -> final-synthesis.md (bounded by spec; citations inline)
  │
  ▼
[Review Gate] -> review.md -> (approve or revise loop)
  │
  ▼
Final Answer (rendered from final-synthesis.md + run metrics)
```

### 1.4 State model (run directory + files)
**Run directory location (Option C, cross-session persistent):**
- Default: `~/.config/opencode/research-runs/<run_id>/`.
- Override: `PAI_DR_RUNS_ROOT` (see `spec-feature-flags-v1.md`).

**Proposed run folder structure (default root):**
```text
~/.config/opencode/research-runs/{run-id}/
  manifest.json                 # canonical run metadata + config + status
  query.md                      # original user query (verbatim)
  perspectives.json             # router output (angles, agent assignment, track)
  wave-1/                       # raw researcher outputs (structured headers)
  wave-2/                       # optional specialist outputs
  citations/
    extracted-urls.txt
    validated-citations.md
    citations.jsonl             # canonical citation records
    hallucination-report.md
  summaries/
    summary-{sourcefile}.md     # bounded summaries (3–5KB each)
  synthesis/
    final-synthesis.md
    review-1.md ... review-N.md
  logs/
    orchestrator.log.jsonl
  gates.json                    # gate outcomes + metrics snapshot
```

**Run manifest schema (minimum fields):**
- `run_id`, `created_at`, `session_id`
- `query`
- `mode`: quick|standard|extensive|iterative
- `router`: perspective count, allocation, tracks
- `waves`: wave1/wave2 status, agent outputs, timeouts
- `citations`: extracted count, validated count, invalid count, utilization %
- `summaries`: expected vs actual
- `synthesis`: iterations, approved boolean
- `failures`: retry counts and reasons

---

## 2) Mapping legacy -> new OpenCode-native components

### 2.1 Legacy decomposition (what exists)
From the legacy orchestrator and subcommands, the core phases are:
- Init: session dir + query analysis + track allocation
- Collect: wave1 launch -> wait -> pivot -> wave2 -> citation validation
- Synthesize: citation pooling + parallel summarizers + synthesis writer + reviewer loop
- Validate: utilization/structure/density checks

### 2.2 Mapping table
| Legacy component (path) | Legacy responsibility | New OpenCode-native component |
|---|---|---|
| `.../.claude/commands/conduct-research-adaptive.md` | top-level orchestrator, phase ordering, gate checks | **OpenCode slash command** `/research-adaptive` + **research skill workflow** wrapper |
| `.../.claude/commands/_research-init.md` | creates session dir, perspective analysis, track allocation | **Init + Router stage** writing `manifest.json` + `perspectives.json` |
| `.../.claude/commands/_research-collect.md` | orchestrates wave phases via markers | **Wave Executor** stage with explicit manifest updates + OpenCode todos |
| `.../_research-collect-wave1.md` | fan-out launch with strict per-agent prompt template | **Wave 1 Fan-out contract** |
| `.../_research-collect-wave2.md` | conditional fan-out specialists | **Wave 2 Fan-out contract** |
| `.../_research-collect-validate.md` + `skills/CitationValidation/*` | citation extraction + validation + formatting | **Citation Pipeline** + validated pool artifacts |
| `.../_research-synthesize-parallel.md` | summarize-per-file fan-out + synthesis-writer + reviewer loop | **Summarization Pipeline** + **Synthesis + Review Gate** |
| `.../_research-validate.md` | final quality validation of synthesis | **Quality Gates** stage |
| `.../utilities/query-analyzer/*` | LLM/keyword query analyzer CLI | **Router prompt contract** inside OpenCode |
| `.../utilities/quality-analyzer/cli.ts` | scoring, signals, gaps, pivot decision CLI | **Pivot Analyzer contract** |

### 2.3 “Not a port” improvements (productization)
- Use `manifest.json + gates.json` as canonical truth.
- Router/Pivot become contracts with structured outputs.
- Synthesis reads only summary pack + validated citations.

---

## 3) Context-management design

### 3.1 Scoped prompts & validation contracts
Every subagent gets only:
- one perspective / one gap,
- run id + file paths,
- strict output schema,
- hard size limit,
- tool budget,
- explicit no-unverified-URL requirement.

Wave output contract includes:
- confidence + rationale,
- coverage notes,
- domain signals,
- sources list.

Self-validation contract:
- writes output to expected file,
- minimum content length,
- machine-extractable sources section.

### 3.2 Wave execution model
**Wave 1:** 4–6 perspectives, parallel, timeout per agent.

**Pivot gate output:**
- `launch_wave2: boolean`
- explicit gaps list
- specialist agent recommendations
- capped wave2 fan-out.

**Wave 2:** one specialist per gap; no broad restart.

### 3.3 Summarization boundaries
Orchestrator reads only:
- manifests + gate reports,
- validated citation pool,
- bounded summaries.

Orchestrator should not read:
- all raw wave outputs together,
- unpooled citation dumps.

Summary pack:
- 3–5KB each,
- claim-level citation references,
- uncertainty/conflict notes.

### 3.4 Citation pool design
Two-tier model:
- extracted URLs set,
- validated citation records (`citations.jsonl`) with `cid`, `url`, `status`, `accessed_at`, `title`, `evidence_snippet`, `found_by`.

Validated projection (`validated-citations.md`) filters by status and is the synthesis citation source.

### 3.5 Retry & failure semantics
Failure taxonomy:
- agent output failure -> retry once -> alternate agent -> partial mark,
- citation validation failure -> escalate retrieval path,
- synthesis validation failure -> bounded revision loop,
- context budget breach -> tighter re-summarization.

Hard gates:
- citation pool exists,
- summary pack exists.

Soft gates:
- low utilization,
- minor missing summaries.

---

## 4) Integration plan with existing researcher agents and command system

### 4.1 Existing runtime agents (reuse)
- `~/.config/opencode/Agents/ClaudeResearcher.md`
- `~/.config/opencode/Agents/PerplexityResearcher.md`
- `~/.config/opencode/Agents/GeminiResearcher.md`
- `~/.config/opencode/Agents/GrokResearcher.md`
- `~/.config/opencode/Agents/researcher.md`

Routing guideline:
- technical depth -> Claude/Perplexity,
- synthesis breadth -> Gemini,
- contrarian/real-time -> Grok,
- fallback -> researcher.

### 4.2 Command integration
OpenCode supports:
- slash commands,
- `/session/:id/command`,
- session todos,
- permission controls.

Proposed surface:
- `/research-adaptive "<query>"` (or `/deep-research`).

### 4.3 Alignment with existing research skill
Add adaptive workflow under existing research skill, not separate universe.

---

## 5) Detailed implementation plan: epics -> tasks -> acceptance criteria

### Epic 0 — Product definition & success metrics
Tasks:
1. define supported modes + caps,
2. define output templates,
3. define hard/soft gate thresholds.

Acceptance:
- one-page spec finalized,
- context-exhaustion mitigation explicit.

### Epic 1 — State model & artifact layout
Tasks:
1. run directory schema,
2. manifest schema and update rules,
3. gates schema.

Acceptance:
- deterministic artifact paths,
- resumable run from manifest.

### Epic 2 — Router + Wave contracts
Tasks:
1. router contract,
2. wave1 contract,
3. pivot contract,
4. wave2 contract,
5. retry/timeout rules.

Acceptance:
- bounded fan-out,
- parseable pivot,
- wave2 is gap-only.

### Epic 3 — Citation pipeline
Tasks:
1. extraction rules,
2. validation tiers,
3. canonical pool schema,
4. hallucination report format,
5. synthesis enforcement language.

Acceptance:
- synthesis blocked without citation gate,
- no unverified URLs in final report.

### Epic 4 — Summarization pipeline
Tasks:
1. summary template and cap,
2. summarizer contract,
3. summary completion gate.

Acceptance:
- bounded synthesis input,
- citation references preserved.

### Epic 5 — Synthesis + Review gate
Tasks:
1. synthesis templates,
2. writer contract,
3. reviewer rubric,
4. revision policy.

Acceptance:
- deterministic approve/reject,
- revise without rerunning waves by default.

### Epic 6 — Command UX + session integration
Tasks:
1. top-level command,
2. visible phase todos,
3. final run summary block.

Acceptance:
- one command yields answer + artifact path,
- progress visibility prevents silent stalls.

### Epic 7 — Observability + harness
Tasks:
1. gates/reporting format,
2. run logs,
3. simulation harness with canned outputs,
4. post-run diagnostics checklist.

Acceptance:
- full simulated run possible without web calls,
- gate failures are actionable.

### Sequencing
1. Epic 0 first,
2. Epic 1 parallel with 2/3/4,
3. Epic 3 before Epic 5 finalization,
4. Epic 6 after 1–5,
5. Epic 7 begins early with fixtures.

Parallel streams:
- A: state + command UX,
- B: router/waves,
- C: citations,
- D: summaries/synthesis,
- E: verification/observability.

---

## 6) Verification strategy

### Contract tests
- URL extraction,
- citation canonicalization,
- summary size checks,
- reviewer rubric checks.

### Integration tests
- canary query with small caps and basic validation.

### Simulation harness
- fixture inputs (wave files + citation pool)
- outputs (summaries + synthesis + review report).

### Gates
Hard:
- citation pool ready,
- summary pack ready,
- synthesis approved or explicit escalation.

Soft:
- low utilization,
- high invalid rate,
- missing perspectives.

### Observability
- run event logs,
- gate snapshots,
- optional server log integration.

---

## 7) Migration + rollout strategy

### 7.1 Migration
- Keep existing research workflows intact initially.
- Launch adaptive as opt-in.

### 7.2 Feature flags
- `adaptiveResearch.enabled`
- `adaptiveResearch.maxWave1`
- `adaptiveResearch.maxWave2`
- `adaptiveResearch.citationValidationLevel`
- `adaptiveResearch.synthesisTemplate`

### 7.3 Canary
1. single-operator canary,
2. small caps,
3. strict summary limits,
4. expand after gate metrics stabilize.

### 7.4 Fallback
- On hard-gate failure, fallback to standard research workflow with explicit warning.
- Keep artifacts for diagnosis.

---

## 8) Security and safety controls using OpenCode guardrails

### Tool permissions
- tighten tool approvals where needed,
- wildcard MCP controls in restricted mode,
- deny risky tools for researcher roles.

### Prompt injection containment
- never execute scraped content as instruction,
- constrain wave agent scope,
- synthesis consumes only validated artifacts.

### Citation hallucination containment
- hard citation gate before synthesis,
- synthesis citations restricted to validated pool,
- preserve hallucination reports.

### Data handling
- keep artifacts in scratch,
- sanitize sensitive values,
- support no-web mode for sensitive runs.

---

## 9) Risks and open decisions

### Risks
1. command-only orchestration drift,
2. retrieval flakiness,
3. overhead creep,
4. reviewer loop runaway.

### Open decisions
1. default output template,
2. default citation validation depth,
3. LLM-only router/pivot vs deterministic helper,
4. run history storage policy.

---

## 10) File-path evidence appendix (exact inspected paths)

### Legacy adaptive research stack
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/conduct-research-adaptive.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-init.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-collect.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-collect-wave1.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-collect-wave2.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-collect-validate.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-synthesize.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-synthesize-parallel.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/commands/_research-validate.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/skills/CitationValidation/SKILL.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/skills/CitationValidation/CLAUDE.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/utilities/query-analyzer/README.md`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/utilities/quality-analyzer/cli.ts`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/settings.json`
- `/Users/zuul/Projects/meinl/pai-adaptive-research-extract-structured/.claude/skills/Research/perplexity-researcher-template.md`

### OpenCode source repo
- `/Users/zuul/Projects/opencode/packages/web/src/content/docs/server.mdx`
- `/Users/zuul/Projects/opencode/packages/web/src/content/docs/tools.mdx`
- `/Users/zuul/Projects/opencode/.opencode/command/commit.md`

### PAI/OpenCode graphviz integration repo
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/skills/research/SKILL.md`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/skills/research/QuickReference.md`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/skills/research/Workflows/StandardResearch.md`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/skills/research/Workflows/ExtensiveResearch.md`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/skills/research/Workflows/IterativeResearch.md`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/skills/research/Workflows/ImportResearch.md`

### Runtime researcher agents
- `/Users/zuul/.config/opencode/Agents/ClaudeResearcher.md`
- `/Users/zuul/.config/opencode/Agents/PerplexityResearcher.md`
- `/Users/zuul/.config/opencode/Agents/GeminiResearcher.md`
- `/Users/zuul/.config/opencode/Agents/GrokResearcher.md`
- `/Users/zuul/.config/opencode/Agents/researcher.md`
