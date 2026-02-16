## Verdict (PASS/FAIL)

**FAIL** — Solid framing and correct identification of the *main* missing piece (orchestrator), but the plan still has **unresolved spec-level decisions**, **missing acceptance criteria that map to the stage machine**, and at least **one direct location-of-truth ambiguity** (scratchpad vs research-runs) that will cause implementation drift.

---

## What is implemented vs missing (your view)

### Implemented (as claimed by the plan)
The plan asserts that Phase 00–07 already delivered a substantial deterministic substrate:

- **Artifact-first run state on disk**: `manifest.json`, `gates.json`, `logs/audit.jsonl`, stage dirs (plan **L19–L22**).
- **Deterministic stage transitions** via `deep_research_stage_advance` (plan **L20–L22**).
- **Deterministic wave planning + validation tools**, plus citations/summaries/synthesis/review tooling (plan **L70–L101**).

These claims are plausible and consistent with Option C’s invariants, but the plan does **not** cite the concrete evidence locations (tests, fixtures, example run roots) that would let a reviewer verify “Phase 00–07 built” beyond assertion.

### Missing (correctly identified, but under-specified)
The plan correctly states the primary missing “operator UX” layer:

- A **single orchestrator command** that selects perspectives, runs waves (agent fan-out), writes artifacts, and advances stages to `finalize` (plan **L26–L34**, **L111–L119**).
- Perspective selection policy operationalization (plan **L120–L126**).
- A packaged offline happy-path reaching `finalize` (plan **L127–L129**).

However, it does **not yet** define the orchestrator’s execution model in a way that is testable against the **stage machine spec** (e.g., how `stage_advance` interacts with tool calls, retries, and pause/resume).

---

## Gaps (numbered)

1) **Run-root location ambiguity vs master plan (“scratchpad” vs “research-runs”)**  
   - Master plan: “Run Ledger (manifest + gates state stored in scratchpad)” (**master plan L46–L47**).  
   - Operator plan: acceptance says run root under `/Users/zuul/.config/opencode/research-runs/<run_id>` (**plan L160–L163**).  
   This is either a contradiction or an undocumented evolution. Either way, it must be resolved explicitly because it affects pause/resume, cleanup, and discoverability.

2) **No explicit mapping from milestones/procedures to the stage-machine transition table**  
   The stage machine defines transitions and preconditions (e.g., **init → wave1 requires perspectives.json**; **wave1 → pivot requires Gate B pass**; **citations → summaries requires Gate C pass**) (**stage spec L17–L30**).  
   The plan lists procedures P1–P5 (init, perspectives, wave1 plan, execute wave1, fixture replay) but does not specify:
   - where/how Gate B/C/D/E are evaluated in the operator procedure,
   - when `deep_research_stage_advance` is invoked (and with what “requested_next”),
   - what concrete artifact paths satisfy each precondition.

3) **Perspective selection is recognized as missing, but no decision points are defined**  
   The plan asks the right questions (“where do perspectives come from?”, caps, routing) (**plan L120–L126**) but does not force concrete decisions such as:
   - canonical perspective schema constraints (count bounds, required fields, naming),
   - deterministic selection algorithm vs operator-provided list,
   - “mode → perspectives → agent types” routing table.

4) **Orchestrator is described, but the driver model is not decided (tick-loop vs stage-driven vs artifact-driven)**  
   Missing critical architectural decisions:
   - Is `deep_research_stage_advance` the *only* authority for next stage, with the command merely satisfying preconditions?  
   - Or does the command implement a driver loop that calls `stage_advance` repeatedly until blocked?
   - Idempotency rules for re-running a stage after partial failure (especially for live waves).

5) **Pause/Resume operator workflow is absent from the plan despite being a program invariant**  
   Missing:
   - how to pause a run (stage-machine supports `paused`, **stage spec L36–L37**),
   - how to resume deterministically from artifacts,
   - where the progress tracker/checkpoint files are updated during operator runs.

6) **Acceptance criteria are not consistently “stage-machine checkable”**  
   Example: M1 acceptance says “stage folders populated sufficiently to reach finalize” (**plan L159–L164**).  
   But the stage machine requires Gate C/D pass before synthesis and Gate E metrics pass before finalize (**stage spec L25–L30**).

7) **Operator runbook acceptance is too weak to validate “operator can run it”**  
   M0 acceptance ends at “create run root…create perspectives…plan wave 1…understand what is missing to run live waves” (**plan L145–L151**).

8) **Hard limits / caps are mentioned in higher-level docs but not enforced/validated in the operator plan**  
   Implementation approach specifies fan-out caps per mode and review iteration limits (**implementation approach L41–L45**).

9) **Missing “evidence pointers” for the claimed implemented toolset**  
   The plan lists many tools but does not link to:
   - the tests that prove each major tool contract,
   - fixture bundle IDs that demonstrate each gate scenario,
   - a canonical example run root tree.

10) **The plan doesn’t define the operator-facing error model**  
   Missing: what the operator sees (command output format), how remediation is guided, and where errors are logged.

---

## Improvements (numbered)

1) **Add a “Spec Alignment Matrix” section (single table)**  
   `Stage` | `Preconditions (spec)` | `Artifacts (exact paths)` | `Tool(s) that produce` | `Command step` | `Test/fixture that proves it`.

2) **Force a decision: canonical run-root location & discovery mechanism**

3) **Define the orchestrator driver model with idempotency + resume semantics**

4) **Strengthen M0/M1 acceptance criteria to prove “operator-grade”**

5) **Add explicit “Pause/Resume procedure” to the runbook plan**

6) **Make perspective selection deterministic by default, operator-overridable**

7) **Add “Operator-visible contract” for artifacts**

8) **Add explicit QA review gates for the orchestrator command**

---

## Next 5 work items (with acceptance)

1) **(Arch) Resolve run-root location + update spec references**

2) **(Arch) Write “Spec Alignment Matrix” into the plan or step catalog**

3) **(Engineer) Draft orchestrator design with driver loop + idempotency rules**

4) **(Engineer) Implement offline end-to-end canary to `finalize` (fixture-backed)**

5) **(QA) Create acceptance test plan for orchestrator command (stage-machine compliance)**

---

## Risks

- **Spec drift risk (high)**: Without stage→artifact→tool mapping, orchestrator will drift.
- **Operational confusion risk (high)**: run roots in multiple places undermines pause/resume.
- **False confidence risk (medium-high)**: no fast verification pointers.
- **Retry-loop complexity risk (medium)**: bounded retries must be crisp in state.
- **UX mismatch risk (medium)**: unclear operator errors make it feel fragile.
