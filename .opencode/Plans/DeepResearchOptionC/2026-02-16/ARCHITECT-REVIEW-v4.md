## Verdict

**PASS (acceptable plan)** — v4 is a coherent, stage-driven operator + engineering contract that **can realistically reach real-world end-to-end multi-agent deep research**, because it:
- Anchors authority in the deterministic stage machine (`deep_research_stage_advance`) and artifact-first run roots.
- Explicitly introduces the **drivers boundary** (fixture vs live) needed for isolatable steps and repeatable refinement.
- Defines **real usability milestones** (M1 fixture finalize → M2 live wave1→pivot → M3 live finalize) that, if implemented, constitute end-to-end reality.

## Gaps

1. **Non-negotiable constraint not restated in v4:** master plan forbids OpenCode core changes; v4 should explicitly bind the operator surface (`/deep-research`) to extension surfaces only.
2. **Driver interface too thin for “real-world” capture:** `runAgent()` returns `{ markdown }` only; missing a canonical envelope for metadata needed downstream (agent id/type, timestamps, sources, tool traces, errors, retry count, etc.).
3. **Bounded retry policy is named but not specified:** Gate B/C/D/E retries need a declared policy (max attempts, backoff, escalation, when to “stop hard”, what to record).
4. **Artifact schema contracts referenced but not enforced in the plan text:** v4 lists required artifacts (`pivot.json`, `wave1-plan.json`, `wave-review.json`, citation pools, summary pack), but doesn’t pin them to specific schema versions or validation steps at each transition.
5. **Operator command contract needs integration detail:** `/deep-research <mode> "<query>" ...` is correct as a surface, but v4 doesn’t specify where it will live (repo path), how it’s registered, and how it’s tested end-to-end as a CLI.

## Improvements

- **Make constraint alignment explicit:** add a short section: “No OpenCode core changes; implemented via tools/commands in `pai-opencode-graphviz` only.”
- **Strengthen `runAgent()` output contract:** return a structured payload (e.g., `markdown`, `metadata.json`, `tool_calls.jsonl`, `errors`, `timings`) so ingestion + later gates have deterministic inputs.
- **Add a “Retry + Escalation Directive” table per gate:** max retries, what changes between retries (required), and what evidence is written each attempt.
- **Pin every required artifact to a schema + validator tool:** stage transition table should include “validate with X schema/tool” as a required precondition (not just “exists”).
- **Define fixture recording/replay format:** how live outputs become fixtures (what is recorded, how normalized, how regression diffs are reviewed).

## Next 5 work items (acceptance)

1. **Write `03-orchestrator-design.md` (driver loop, idempotency, retries, audit event types)**
   - Acceptance:
     - Documented driver loop pseudocode with stage advance as the only authority.
     - Explicit retry policy per gate (B/C/D/E) with max attempts and “what changes” rule.
     - Audit event type list + required fields (run_id, stage_from/to, artifact paths, outcome).

2. **Implement/run M1: fixture-run reaches `finalize` with blocking scenarios**
   - Acceptance:
     - `.opencode/tests/smoke/deep_research_fixture_finalize_smoke.test.ts` exists and passes.
     - Fixture directories listed in v4 exist and are consumed by the fixture driver.
     - Assertions: happy fixture reaches `finalize`; each blocking fixture produces typed failure; audit log has one entry per transition.

3. **Implement `deep_research_wave_output_ingest` + entity test**
   - Acceptance:
     - Tool file exists at the planned path and writes canonical `wave-1/*.md` (and metadata) into run root deterministically.
     - `.opencode/tests/entities/deep_research_wave_output_ingest.test.ts` passes with fixture inputs.
     - Ingested artifacts satisfy the wave output validator expectations (no manual steps).

4. **Implement live orchestrator driver using Task tool behind `drivers.runAgent()`**
   - Acceptance:
     - Live driver calls Task tool, captures outputs, and writes them into run root via ingest tool(s).
     - Live mode can complete `init → wave1 → pivot` for one real query with Gate B recorded.

5. **Prove M3: one real operator run reaches `finalize` with gates enforced**
   - Acceptance:
     - A real run root exists containing: citation pool artifact(s), summary pack artifact(s), final synthesis, Gate C/D/E evidence, and bounded review iteration records.
     - `manifest.status` reflects completion and stage.current is `finalize`.
     - Audit trail is sufficient to replay the run in fixture mode (or to diff critical artifacts).
