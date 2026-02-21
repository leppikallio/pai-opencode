> Note: this reviewer hit a tool-step limit mid-turn; review is based on the plan + tool exports + stage_advance.

## Verdict (PASS/FAIL)

**FAIL** (for “runnable M1/M2 now”).  
The plan is directionally solid, but there are still minimal execution gaps before it is truly operator-runnable end-to-end.

---

## Minimal implementation plan (M1)

Smallest changes to make offline canary truly reach `finalize` in one procedure:

1. **Extend command orchestration path** in `.opencode/commands/deep-research.md`  
   Add full offline chain:
   - init → perspectives → wave1 plan
   - wave review + Gate B write
   - pivot decision + stage advance
   - citations pipeline + Gate C write
   - summary pack + Gate D write
   - synthesis + review + Gate E write
   - final stage advance to `finalize`

2. **Fix synthesis stage output gap (critical)**  
   `stage_advance` requires `synthesis/final-synthesis.md` for `synthesis -> review`.  
   Minimal fix: extend `synthesis_write` with an option to write/promote final synthesis (`final-synthesis.md`) deterministically.

3. **Add one end-to-end offline regression test**  
   New test runs the deterministic tool chain and asserts terminal state = `finalize`, with Gate B/C/D/E pass and required artifacts present.

---

## Minimal implementation plan (M2)

Smallest changes to make live Wave 1 runnable (spawn agents, write outputs):

1. **Add one writer/ingest tool for wave outputs** (new tool)  
   Example: `wave_outputs_commit.ts`
   - Input: `manifest_path`, `perspectives_path`, wave id, `{ perspective_id, markdown }[]`
   - Writes `<runRoot>/wave-1/<perspective_id>.md`
   - Runs contract validation (reuse `wave_output_validate`)
   - Returns pass/fail + retry directives

2. **Update command orchestration for live Wave 1**
   - Read `wave1-plan.json`
   - Spawn bounded Task calls
   - Collect outputs
   - Call `wave_outputs_commit`
   - If pass: write Gate B + advance to pivot
   - If fail: bounded retries only for failed perspectives

3. **Export new tool** in `.opencode/tools/deep_research_cli/index.ts` and add deterministic tests.

---

## Suggested file/module layout

- Entrypoint:
  - `.opencode/commands/deep-research.md` (single dispatcher: offline canary + live wave1 path)

- New/updated tools:
  - `.opencode/tools/deep_research_cli/wave_outputs_commit.ts` *(new)*
  - `.opencode/tools/deep_research_cli/synthesis_write.ts` *(extend with final output mode)*
  - `.opencode/tools/deep_research_cli/index.ts` *(export new tool)*

- Optional helper:
  - `.opencode/tools/deep_research_cli/orchestrator_contracts.ts` (shared response shapes, gate patch helpers)

---

## Integration risks

1. **OpenCode command step/call limits** — per-perspective validate loops can exceed limits; batch ingestion tool is important.
2. **Task latency/blocking** — need bounded parallelism and retry caps.
3. **Context/window blowup** — persist outputs immediately; keep only paths/digests in context.
4. **Runtime mismatch in command text** — ensure command doesn’t assume unavailable todo tooling.
5. **Stage bypass footgun** — `requested_next` can bypass decision artifacts if not constrained.
6. **Revision races** — handle optimistic-lock failures in `gates_write`/`manifest_write`.
