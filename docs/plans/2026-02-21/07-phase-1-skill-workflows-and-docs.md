# Deep Research Option C — Phase 1D (Skill workflows + docs) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Make the `deep-research` skill a complete operator runbook: one canonical driver loop, clear canaries, and explicit warnings about scaffold vs real research.

**Architecture:** Treat `/.opencode/skills/deep-research/**` as the canonical operator contract. Keep workflows short, explicit, and copy/pasteable. Ensure docs align with CLI invocation realities (repo vs runtime) and `--json` usage.

**Tech Stack:** Markdown docs; skill install flow via repo → `Tools/Install.ts` (no direct runtime edits).

---

## Phase outputs (deliverables)

- New workflow: `Workflows/LLMDriverLoop.md` (canonical “tick/task → agent-result → tick” loop).
- New workflows: `Workflows/RunM2Canary.md`, `Workflows/RunM3Canary.md`.
- `SKILL.md` updated to:
  - explain repo vs runtime invocation clearly,
  - recommend `--json` for LLM-driving,
  - recommend `--run-id` for deterministic reproduction,
  - warn that generate/fixture paths are scaffolds unless explicitly running task/live.
- `SynthesisAndReviewQualityLoop.md` strengthened with prominent scaffold warning.

## Task 1D.1: Add canonical LLM driver loop workflow

**Files:**
- Create: `.opencode/skills/deep-research/Workflows/LLMDriverLoop.md`

**Step 1: Write the workflow**

Must include:
- Canonical CLI invocation (repo and runtime examples)
- `init` command (with explicit `--run-id` recommendation)
- Loop:
  - `tick --driver task --json`
  - if `RUN_AGENT_REQUIRED`, write outputs to `operator/outputs/<stage>/<perspective>.md`
  - run `agent-result ...`
  - re-run tick
- How to use `halt.next_commands` when present

**Step 2: Commit**

```bash
git add .opencode/skills/deep-research/Workflows/LLMDriverLoop.md
git commit -m "docs(deep-research): add canonical LLM driver loop workflow"
```

## Task 1D.2: Add M2/M3 canary workflows

**Files:**
- Create: `.opencode/skills/deep-research/Workflows/RunM2Canary.md`
- Create: `.opencode/skills/deep-research/Workflows/RunM3Canary.md`

**Step 1: Write M2 canary workflow**

Include:
- Which test is the canary:
  - `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`
- What it proves (stage progression + Gate B pass)
- What it does *not* prove (real web, real agent autonomy)

**Step 2: Write M3 canary workflow**

Include:
- Which test is the canary:
  - `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`
- What it proves (finalize + Gate E pass)
- What it does *not* prove

**Step 3: Commit**

```bash
git add .opencode/skills/deep-research/Workflows/RunM2Canary.md .opencode/skills/deep-research/Workflows/RunM3Canary.md
git commit -m "docs(deep-research): add M2/M3 canary workflows"
```

## Task 1D.3: Update SKILL.md to align with CLI + contracts

**Files:**
- Modify: `.opencode/skills/deep-research/SKILL.md`

**Step 1: Update CLI invocation section**

Add a short block:

- Repo invocation: `bun ".opencode/pai-tools/deep-research-cli.ts" ...`
- Runtime invocation: `bun "pai-tools/deep-research-cli.ts" ...`
- Rule: use whichever exists; prefer `--json` for LLM driving.

**Step 2: Add determinism guidance**

- Recommend always setting `--run-id` for reproducible debugging.

**Step 3: Add scaffold warning**

- Explain fixture/generate modes are scaffolding unless explicitly using task/live with agent outputs.

**Step 4: Commit**

```bash
git add .opencode/skills/deep-research/SKILL.md
git commit -m "docs(deep-research): align SKILL.md with CLI contracts and quality modes"
```

## Task 1D.4: Strengthen SynthesisAndReviewQualityLoop warning

**Files:**
- Modify: `.opencode/skills/deep-research/Workflows/SynthesisAndReviewQualityLoop.md`

**Step 1: Add a prominent warning block**

- “Generate-mode synthesis/review is deterministic scaffolding; do not treat it as real research.”

**Step 2: Commit**

```bash
git add .opencode/skills/deep-research/Workflows/SynthesisAndReviewQualityLoop.md
git commit -m "docs(deep-research): clarify scaffold vs real research in synthesis/review workflow"
```

## Task 1D.5: (Optional) Install updated skill into runtime (no direct edits)

**Files:**
- (none)

Run:

```bash
bun Tools/Install.ts --target "/Users/zuul/.config/opencode"
```

Expected: runtime skill docs updated.

## Phase 1D Gate

**Gate execution (required):**

- Architect agent must review doc changes for correctness and completeness.
- QATester agent must run the doc-targeted checks (link sanity if present) and report PASS/FAIL.

### Architect Gate — PASS checklist

- [ ] Workflows are copy/pasteable and unambiguous.
- [ ] Repo vs runtime invocation is explicitly documented.
- [ ] Scaffold vs real research is clearly warned.

### QA Gate — PASS checklist

```bash
# Minimal: ensure no TODO markers in new workflows
rg -n "TODO|TBD|FIXME" .opencode/skills/deep-research/Workflows
```

Expected: no matches.
