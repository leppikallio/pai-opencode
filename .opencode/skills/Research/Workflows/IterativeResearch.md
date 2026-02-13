# Iterative Research Workflow

**Mode:** Stateful multi-turn research | **Timeout:** Variable (checkpoint every turn)

Use this workflow when research spans multiple turns, large files, or evolving questions.

## When to Use

- User asks follow-up questions on existing collected data
- Research involves large documents/PDFs and cannot be one-shot
- Work must refine over time instead of restarting
- Parallel sessions where continuity is mandatory

## Core Principle

Every turn must start by rehydrating existing state, then make a focused delta.

**Never start from scratch if prior artifacts exist.**

## State Pack (Scratchpad)

Store these files under the current work scratch directory:

- `research-state.md` - scope, assumptions, decisions, current hypothesis
- `research-facts.jsonl` - atomic facts with source, confidence, timestamp
- `research-open-questions.md` - unresolved questions only
- `research-next.md` - next concrete actions

If these files are missing but prior research artifacts exist, first run `ImportResearch.md`.

## Workflow

### Step 0: Rehydrate First (Mandatory)

Before any new search or extraction:

1. Read all State Pack files that exist
2. Summarize:
   - What is already known
   - What is still unknown
   - What conflicts exist
   - What changed since last iteration
3. Continue from that state

### Step 1: Choose One Delta Objective

Pick one focused objective for this turn:

- Resolve one open question
- Validate one disputed claim
- Add facts for one new subtopic
- Reduce uncertainty in one area

### Step 2: Targeted Collection (No Broad Reset)

- Run only the minimum retrieval needed for the delta objective
- Reuse existing sources first; add new sources only if required
- For subagents, prefer resuming the same subagent via `task_id`

### Step 3: Record Structured Evidence

Append to `research-facts.jsonl` entries like:

```json
{"id":"F-017","claim":"...","source":"URL or file","evidence":"quote/snippet","confidence":"high","ts":"2026-02-12T10:00:00Z"}
```

### Step 4: URL/Source Verification

Apply URL verification protocol before using external URLs in conclusions.

### Step 5: Update State Pack (Mandatory)

At end of turn, update:

- `research-state.md` (new decisions, changed assumptions)
- `research-open-questions.md` (remove resolved, add new)
- `research-next.md` (next 1-3 actions)

If these files are unchanged, the turn is incomplete.

### Step 6: Ask Data-Bound Questions (When Needed)

If user input is needed, ask with this structure:

- Question
- Why it matters
- Facts used (fact IDs)
- What decision changes based on answer

## Output Contract per Iteration

Every response should include:

1. **Rehydrated state summary** (known/unknown/conflicts)
2. **Delta executed this turn**
3. **New facts added** (IDs)
4. **Questions resolved**
5. **Open questions remaining**
6. **Next step**

# IterativeResearch

## Purpose
Continue an existing research thread **without resetting context**, by rehydrating prior state and executing a focused delta.

Use this when:
- The request is a follow-up ("continue", "dig deeper", "update section X").
- There are existing scratch artifacts from prior research.
- The work involves large-file analysis that benefits from incremental progress.

## Inputs
- Your follow-up question or refinement.
- Existing artifact directory (scratchpad or history).

## Required artifacts (state pack)
Maintain these in the session scratch directory:
- `research-state.md` — current thesis + scope + what’s already known
- `facts.jsonl` — atomic facts with sources/citations
- `open-questions.md` — what remains unresolved
- `next-steps.md` — planned deltas for the next iterations

## Workflow

### Step 1: Rehydrate
1. Locate prior artifacts (prefer session scratch; fallback to History).
2. Read `research-state.md`, `facts.jsonl`, `open-questions.md`.
3. Summarize: what we know, what changed, what we’re doing next.

### Step 2: Execute one delta
1. Define a single "delta objective" (one section, one claim set, one update).
2. Run only the minimum necessary new collection/analysis.
3. Record new facts into `facts.jsonl` with citations.

### Step 3: Update state pack
1. Update `research-state.md` to reflect new understanding.
2. Move resolved items out of `open-questions.md`.
3. Append a concise `next-steps.md` entry.

### Step 4: Return
Return:
- The updated answer/result for the requested delta
- Pointers to updated state pack artifacts

## Guardrails
- Do not restart broad discovery unless state is missing/corrupted.
- Treat citations as first-class: new facts must include a source.
- Keep deltas small and verifiable.
