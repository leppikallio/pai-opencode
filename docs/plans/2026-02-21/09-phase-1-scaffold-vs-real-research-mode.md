# Deep Research Option C — Phase 1E (Scaffold vs real research mode) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Prevent “false confidence” where deterministic generate/fixture artifacts pass gates but are mistaken for real research quality.

**Architecture:** Add explicit, persisted *mode metadata* to key artifacts (summary-pack + synthesis). Gate E and review tooling must surface warnings when artifacts were produced by scaffolding paths.

**Tech Stack:** Tool layer summary/synthesis writers and Gate E evaluator/review; bun:test regression tests.

---

## Phase outputs (deliverables)

- `summary_pack_build` writes a sidecar meta (e.g., `summaries/summary-pack.meta.json`) including `{ mode: "generate"|"fixture"|"task" }`.
- `synthesis_write` writes `synthesis/final-synthesis.meta.json` including `{ mode: "generate"|"fixture"|"task" }`.
- `gate_e_evaluate` and/or `review_factory_run` surfaces a warning when synthesis mode is `generate`.

## Task 1E.1: Failing regression test — Gate E warns on generate synthesis

**Files:**
- Create: `.opencode/tests/regression/deep_research_gate_e_warns_on_generate_synthesis_regression.test.ts`
- Modify later: `.opencode/tools/deep_research_cli/gate_e_evaluate.ts` or `.opencode/tools/deep_research_cli/review_factory_run.ts`

**Step 1: Write failing regression test**

Test strategy:
- Materialize a small fixture run root that includes `synthesis/final-synthesis.md`.
- Create `synthesis/final-synthesis.meta.json` with `{ mode: "generate" }`.
- Run `gate_e_evaluate` (or `review_factory_run`) and assert warnings include a code like `SCAFFOLD_SYNTHESIS`.

Expected today: FAIL (no warning exists).

## Task 1E.2: Write synthesis meta sidecar in synthesis_write

**Files:**
- Modify: `.opencode/tools/deep_research_cli/synthesis_write.ts`

**Step 1: Write meta file**

After writing `synthesis/final-synthesis.md`, write:

- `synthesis/final-synthesis.meta.json` with:
  - `schema_version: "synthesis_meta.v1"`
  - `mode: "generate" | "fixture" | "task"`
  - `generated_at`
  - `inputs_digest` (canonical)

**Step 2: Commit**

```bash
git add .opencode/tools/deep_research_cli/synthesis_write.ts
git commit -m "feat(dr): write synthesis meta sidecar with mode"
```

## Task 1E.3: Write summary-pack meta sidecar in summary_pack_build

**Files:**
- Modify: `.opencode/tools/deep_research_cli/summary_pack_build.ts`

**Step 1: Write meta file**

- `summaries/summary-pack.meta.json` with:
  - `schema_version: "summary_pack_meta.v1"`
  - `mode`
  - `generated_at`
  - `inputs_digest`

**Step 2: Commit**

```bash
git add .opencode/tools/deep_research_cli/summary_pack_build.ts
git commit -m "feat(dr): write summary-pack meta sidecar with mode"
```

## Task 1E.4: Surface scaffold warnings in Gate E and/or review

**Files:**
- Modify: `.opencode/tools/deep_research_cli/gate_e_evaluate.ts` (preferred)
- OR modify: `.opencode/tools/deep_research_cli/review_factory_run.ts`

**Step 1: Read meta and warn**

- If `synthesis_meta.mode === "generate"`, add warning code `SCAFFOLD_SYNTHESIS`.
- Optionally, if `summary_pack_meta.mode === "generate"`, add warning `SCAFFOLD_SUMMARY_PACK`.

**Step 2: Make regression test PASS + commit**

```bash
bun test .opencode/tests/regression/deep_research_gate_e_warns_on_generate_synthesis_regression.test.ts
git add .opencode/tools/deep_research_cli/gate_e_evaluate.ts .opencode/tests/regression/deep_research_gate_e_warns_on_generate_synthesis_regression.test.ts
git commit -m "feat(dr): warn when Gate E uses scaffold-generated artifacts"
```

## Phase 1E Gate

**Gate execution (required):**

- Architect agent validates warnings are non-breaking but visible.
- QATester agent runs regression tests.

### QA Gate — PASS checklist

```bash
bun test .opencode/tests/regression/deep_research_gate_e_warns_on_generate_synthesis_regression.test.ts
```

Expected: PASS.
