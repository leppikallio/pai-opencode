# Import Existing Research Workflow

**Mode:** Bootstrap existing artifacts into iterative state pack

Use this when research already exists in a scratchpad or folder and must be imported into the iterative research system.

## When to Use

- User says: "import this research", "continue from this scratchpad", "don't start over"
- Existing files already contain findings, links, notes, extracted text, or drafts
- Current state pack files are missing or incomplete

## Goal

Convert existing artifacts into canonical state files so follow-up work is cumulative:

- `research-state.md`
- `research-facts.jsonl`
- `research-open-questions.md`
- `research-next.md`

## Intake Protocol (Ask Missing Details)

If any required detail is missing, ask targeted questions before importing.

Required details:
1. Source directory path (usually scratchpad)
2. Research objective/topic label
3. Which artifact files are authoritative (if multiple conflict)
4. Desired confidence posture (conservative/default/aggressive)

### Question Template (use structured question flow)

Ask only unresolved fields, one-by-one:

- **Authoritative source preference**
  - Latest timestamp wins
  - Explicitly tagged final files win
  - User chooses per conflict

- **Confidence posture**
  - Conservative (high evidence bar)
  - Balanced (default)
  - Aggressive (capture more tentative claims)

## Workflow

### Step 0: Inventory Existing Artifacts

Scan the provided directory and categorize files:

- Summaries/finals (`final.md`, `summary*.md`)
- Working notes (`draft*.md`, `notes*.md`, `iteration*.md`)
- Extracted content (`*.txt`, `*.md`, extraction outputs)
- Source evidence (URLs, citations, PDFs, scraped outputs)

Create `import-inventory.md` listing files by category.

### Step 1: Resolve Conflicts and Authority

Where files disagree, apply the selected authority rule.

Create `import-decisions.md` with:
- Conflict
- Chosen source
- Reason

### Step 2: Build Canonical State Files

Generate/overwrite in target scratchpad:

1. `research-state.md`
   - Topic/scope
   - Current hypothesis
   - Assumptions
   - Key decisions

2. `research-facts.jsonl`
   - Atomic fact per line with fields:
   - `id`, `claim`, `source`, `evidence`, `confidence`, `ts`

3. `research-open-questions.md`
   - Unresolved questions only
   - Include priority (high/medium/low)

4. `research-next.md`
   - Next 1-3 highest-leverage actions

### Step 3: Integrity Check (Mandatory)

Before declaring import complete, verify:

- All 4 canonical files exist and are non-empty
- Every open question is not already answered by current facts
- Every high-confidence fact has explicit evidence text
- Imported facts include source references

### Step 4: Handoff to Iterative Workflow

After import success, continue using `IterativeResearch.md` only.

First iterative turn must start with rehydration summary from imported state files.

## Output Contract

Return:

1. Imported file count and categories
2. Conflict decisions made
3. Number of facts imported (by confidence)
4. Number of open questions
5. First suggested iterative delta objective

# ImportResearch

## Purpose
Bootstrap a canonical iterative research **state pack** from existing artifacts (scratchpad notes, prior outputs, pasted files).

Use this when:
- There is clearly prior work, but no canonical `research-state.md` / `facts.jsonl` pack.
- The user provides a folder, paste, or “continue from these files”.

## Output (state pack)
Create/refresh:
- `research-state.md`
- `facts.jsonl`
- `open-questions.md`
- `next-steps.md`

## Workflow

### Step 1: Inventory artifacts
1. List what you have (files, notes, links, screenshots).
2. Identify duplicates or conflicting versions.

### Step 2: Normalize into facts
1. Extract atomic facts into `facts.jsonl`.
2. Each fact MUST include a source pointer (URL, file path + line range, or explicit “user provided”).

### Step 3: Construct state
1. Write `research-state.md`:
   - question
   - current conclusions
   - what’s uncertain
2. Write `open-questions.md` from unresolved items.
3. Write `next-steps.md` as the next 1–3 deltas.

### Step 4: Hand off
Proceed using `IterativeResearch.md` for subsequent turns.

## Guardrails
- Do not invent citations.
- If an artifact is ambiguous, label it as such and keep it out of `facts.jsonl` until verified.
