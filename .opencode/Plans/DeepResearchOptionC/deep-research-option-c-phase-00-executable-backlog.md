# Phase 00 Executable Backlog (Owner/Reviewer Mapped)

## Execution Goal
Pass **Gate A (Planning Completeness)** with signed-off schemas, gate rubrics, and governance controls.

## Status Legend
- `pending` — not started
- `in_progress` — active now
- `review` — waiting reviewer decision
- `done` — accepted
- `blocked` — dependency/risk blocked

## Backlog Board

**Evidence policy:** every task must include an explicit “Evidence” statement in its deliverable.

| ID | Workstream | Task | Owner | Reviewer | Dependencies | Status | Deliverable | Evidence (what proves done) |
|---|---|---|---|---|---|---|---|
| P00-A01 | WS-00A | Define canonical `manifest.json` schema v1 | Architect | Engineer | none | done | `spec-manifest-schema-v1.md` | JSON example + field table + invariants |
| P00-A02 | WS-00A | Define canonical `gates.json` schema v1 | Architect | Engineer | P00-A01 | done | `spec-gates-schema-v1.md` | JSON example + gate lifecycle rules |
| P00-A03 | WS-00A | Define `perspectives.json` + `summary-pack.json` schemas | Architect | Engineer | P00-A01 | done | `spec-router-summary-schemas-v1.md` | JSON examples + size caps |
| P00-A04 | WS-00A | Define `citations.jsonl` canonical record schema | Architect | QATester | P00-A01 | done | `spec-citation-schema-v1.md` | JSONL examples + validation rules |
| P00-A05 | WS-00A | Produce schema examples (valid/invalid) for harness usage | Engineer | QATester | P00-A02,P00-A03,P00-A04 | done | `schema-examples-v1.md` | At least 2 valid + 2 invalid examples per schema |
| P00-B01 | WS-00B | Define Gate A–F hard/soft criteria and thresholds | Architect | QATester | none | done | `spec-gate-thresholds-v1.md` | Threshold table + pass/fail examples |
| P00-B02 | WS-00B | Define reviewer rubrics per gate (pass/fail evidence) | QATester | Architect | P00-B01 | done | `spec-reviewer-rubrics-v1.md` | Rubric checklist per gate |
| P00-B03 | WS-00B | Define escalation and override policy for blocked gates | Engineer | Architect | P00-B01 | done | `spec-gate-escalation-v1.md` | Decision tree + max retries |
| P00-C01 | WS-00C | Define branch strategy and PR quality checks | Engineer | Architect | none | done | `spec-branch-pr-policy-v1.md` | Branch naming + required checks |
| P00-C02 | WS-00C | Define pause/resume SOP and checkpoint protocol | Architect | Engineer | none | done | `spec-pause-resume-v1.md` | SOP steps + templates |
| P00-C03 | WS-00C | Define rollback and fallback governance | Engineer | Architect | P00-C01 | done | `spec-rollback-fallback-v1.md` | Rollback playbook + triggers |
| P00-X01 | Cross | Conduct architecture-review checkpoint (contracts + gates) | Architect | Engineer | P00-A04,P00-B03 | done | `PHASE-00-CHECKPOINT-ARCH-REVIEW.md` | Reviewer PASS on schemas/gates |
| P00-X02 | Cross | Conduct QA-review checkpoint (rubrics + examples) | QATester | Architect | P00-A05,P00-B02 | done | `PHASE-00-CHECKPOINT-QA-REVIEW.md` | Reviewer PASS on rubrics/examples |
| P00-X03 | Cross | Gate A final signoff and transition approval to Phase 01/02 | Architect | QATester | P00-X01,P00-X02,P00-C03 | done | `PHASE-00-CHECKPOINT-GATE-A-SIGNOFF.md` | Signed checklist + next-phase unlock |

## Parallel Execution Plan

### Wave 1 (Immediate)
- P00-A01, P00-B01, P00-C02 (all independent)

### Wave 2
- P00-A02, P00-A03, P00-A04, P00-B02, P00-B03, P00-C01

### Wave 3
- P00-A05, P00-C03

### Wave 4 (Review + gate)
- P00-X01, P00-X02, P00-X03

## Reviewer Protocol (Builder/Reviewer Pairing)
1. Builder marks task `review` only with linked deliverable.
2. Reviewer checks contract compliance + evidence completeness.
3. Reviewer marks `done` or returns `changes_required` note.
4. No downstream dependent task starts until upstream dependency is `done`.

## Daily Operating Cadence (Phase 00)
- **Start of day:** update statuses and blockers.
- **Mid-day:** reviewer sync for in-review tasks.
- **End of day:** checkpoint snippet appended to tracker.

## Phase 00 Completion Definition
Phase 00 is complete only when:
- all P00-A*, P00-B*, P00-C* tasks are `done`,
- P00-X03 Gate A signoff is `done`,
- tracker updated to move current phase to Phase 01.
