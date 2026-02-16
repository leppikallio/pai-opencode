# Option C Master Plan — First-Class Deep Research Platform Integration (12–16 weeks)

## Decision
Selected: **Option C (Ambitious)**

## START HERE (PM / Orchestrator)
If you are orchestrating this program (human or agent), read in this order:
1. `deep-research-option-c-progress-tracker.md`
2. `deep-research-option-c-recovery-pack.md`
3. Current phase executable backlog (starts with `deep-research-option-c-phase-00-executable-backlog.md`)
4. `deep-research-option-c-reference-index.md` (all canonical links)

If session context is compacted or lost, **do not rely on memory** — follow:
- `deep-research-option-c-recovery-pack.md`

## Strategic Objective
Build deep research as a **first-class OpenCode capability** with:
- programmatic orchestration (not prompt-only choreography),
- heavy parallelization,
- automated quality gates,
- reviewer subagent checkpoints,
- robust pause/resume state.

## Non-negotiable constraint
**No changes to OpenCode core** (`/Users/zuul/Projects/opencode`).

Option C must be delivered via:
- OpenCode-supported extension surfaces (custom tools, commands, MCP, plugins), and
- the PAI/OpenCode integration repo (`/Users/zuul/Projects/pai-opencode-graphviz`).

## Architecture invariants (anti-vision-drift)
These MUST remain true across all phases unless Phase 00 explicitly revises the schemas/gates:
1. **Artifact-first:** run state lives on disk; chat transcript is not the archive.
2. **Bounded synthesis:** synthesis reads only `summary-pack.json` + validated citation pool.
3. **Hard gates block:** Gate C (citations) and Gate D (summary bounds) block synthesis.
4. **Existing agents only:** use existing runtime researcher agents; no new “agent universe”.
5. **No OpenCode core changes:** deliver via tools/commands/plugins/MCP only.
6. **Entity tests required:** every functional entity ships with isolated, fixture-driven tests.

## Program Architecture (high-level)
1. **Tool-driven Stage Machine** (custom tools implement deterministic stage transitions)
2. **Agent Work Graph** (wave fan-out/fan-in via Task tool using existing agents)
3. **Evidence/Citation Services** (tools + MCP-backed retrieval; validated citation pool)
4. **Synthesis & Reviewer Factory** (writer/reviewer loop + bounded summary pack)
5. **Quality Gates** (A–F as machine-checkable artifacts + reviewer rubrics)
6. **Run Ledger** (canonical run roots stored under `~/.config/opencode/research-runs/`; scratchpad stores temporary drafts)

## Phase Plan (separate files)
- `deep-research-option-c-phase-00-governance.md`
- `deep-research-option-c-phase-00-executable-backlog.md`
- `deep-research-option-c-phase-01-platform-core.md`
- `deep-research-option-c-phase-01-executable-backlog.md`
- `deep-research-option-c-phase-02-orchestrator-engine.md`
- `deep-research-option-c-phase-02-executable-backlog.md`
- `deep-research-option-c-phase-03-agent-contracts.md`
- `deep-research-option-c-phase-04-citation-system.md`
- `deep-research-option-c-phase-05-synthesis-review-factory.md`
- `deep-research-option-c-phase-06-observability-quality.md`
- `deep-research-option-c-phase-07-rollout-hardening.md`

## Concrete execution artifacts (what makes this “real”)
- Implementation approach (how we execute work + reviews):
  - `deep-research-option-c-implementation-approach.md`
- Pause/resume / recovery:
  - `deep-research-option-c-progress-tracker.md`
  - `deep-research-option-c-recovery-pack.md`
  - `deep-research-option-c-reference-index.md`
- Phase 00 deliverable specs (schemas + gates + governance):
  - `spec-manifest-schema-v1.md`
  - `spec-gates-schema-v1.md`
  - `spec-router-summary-schemas-v1.md`
  - `spec-citation-schema-v1.md`
  - `spec-gate-thresholds-v1.md`
  - `spec-reviewer-rubrics-v1.md`
  - `spec-gate-escalation-v1.md`
  - `spec-pause-resume-v1.md`
  - `spec-branch-pr-policy-v1.md`
  - `spec-rollback-fallback-v1.md`
  - `schema-examples-v1.md`

## Parallelization Model
### Horizontal
- Run multiple research angles in parallel (Wave 1 and Wave 2).
- Run summarizers in parallel for each completed artifact.
- Run citation checks in parallel with bounded worker pool.

### Vertical (pairing)
- Every critical builder stream has a paired reviewer stream:
  - **Builder:** Engineer / researcher specialization
  - **Reviewer:** QATester / Architect / specialized validator

## Quality Gate Topology
1. **Gate A**: Planning completeness
2. **Gate B**: Wave output contract compliance
3. **Gate C**: Citation validation threshold met
4. **Gate D**: Summary pack size + coverage checks
5. **Gate E**: Synthesis quality + utilization thresholds
6. **Gate F**: Rollout safety checks

Hard gates block advancement. Soft gates emit warnings and risk notes.

## Pause/Resume Design
- Canonical tracker file: `deep-research-option-c-progress-tracker.md`
- Canonical run state schema (to implement): `research.manifest.json`
- Phase checkpoint convention:
  - `PHASE-{NN}-CHECKPOINT.md`
  - fields: `completed_tasks`, `in_flight_tasks`, `blockers`, `next_action`

## Weekly Cadence
- **Mon**: planning + assignment
- **Wed**: midpoint technical review
- **Fri**: gate review + tracker update + checkpoint cut

## Exit Criteria (program-level)
- End-to-end run succeeds with no context exhaustion in standard mode.
- Citation validity and utilization meet thresholds.
- Run can be paused/resumed from manifest without manual reconstruction.
- Fallback behavior and canary rollout validated.
