# Epic E5 — Config precedence + citations operator guidance + fixture capture

Status: TODO

## Context links (source reviews)
- Engineer: `../engineer-review-raw-2.md` (citations sections: endpoints, online fixtures, blocked URLs)
- Architect: `../architect-review-raw-2.md` (config precedence; surface blocked urls in inspect; fixture capture workflow)

## Repo + worktree
- Repo root: `/Users/zuul/Projects/pai-opencode-graphviz`
- Epic worktree: `/private/tmp/pai-dr-epic-e5`
- Epic branch: `ws/epic-e5-config-citations`

## Target files
- Run-config emission: `.opencode/pai-tools/deep-research-option-c.ts`
- Citation validation:
  - `.opencode/tools/deep_research/citations_validate.ts`
  - `.opencode/tools/deep_research/citations_validate_lib.ts`
- Flags/config:
  - `.opencode/tools/deep_research/flags_v1.ts`
  - `.opencode/tools/deep_research/run_init.ts` (manifest snapshot)

## Outcomes (what “done” means)
1) Config precedence is explicit and stable: post-init uses run artifacts as source of truth.
2) Citations stage is operationally friendly:
   - online fixtures are always captured (in online mode)
   - blocked URLs are surfaced in CLI inspect with next steps
3) Fixture bundle capture is a first-class operator action (`capture-fixtures`).

## Bite-sized tasks

### E5-T0 — Document config precedence rules
Create: `.opencode/Plans/DeepResearchOptionC/2026-02-18/followup/E5-config-precedence.md`
Include:
- Which fields are authoritative after init:
  - `manifest.query.constraints.deep_research_flags`
  - `run-config.json` (effective config)
- When env vars are allowed (explicit override only)
- How citations endpoints are resolved

Acceptance:
- Doc exists and is referenced by this epic.

### E5-T1 — Persist effective citations config into run-config.json
Goal: operator never needs to set env vars “just to run citations.”

Steps:
- Extend `run-config.json` written by CLI to include:
  - `citations.endpoints.brightdata` (optional)
  - `citations.endpoints.apify` (optional)
  - `citations.mode` (`offline|online|dry_run`) resolved from manifest sensitivity
- Ensure the config includes a `source` field (settings/env/run-config) for audit.

Acceptance:
- A run root has enough config to attempt online citations deterministically.

### E5-T2 — Teach citations_validate to prefer run-config/manifest over env
Goal: bound nondeterministic seams on resume.

Steps:
- Add a small resolver:
  1) check manifest constraints
  2) check run-config.json if present
  3) only then fall back to env vars
- Ensure the effective config is written into the online fixtures metadata.

Acceptance:
- Two resumes in different shells do not silently change ladder behavior.

### E5-T3 — Add “latest pointer” for online fixtures
Goal: avoid timestamp-only file discovery.

Steps:
- When writing `citations/online-fixtures.<ts>.json`, also write:
  - `citations/online-fixtures.latest.json` (copy or small pointer JSON with `{ path, ts }`).

Acceptance:
- Operator can reliably find the latest fixtures without guessing filenames.

### E5-T4 — Surface citations blockers in CLI inspect
Goal: make blocked URLs a first-class UX.

Steps:
- In CLI `inspect`, if `citations/blocked-urls.json` exists:
  - print summary (count by status)
  - print top N actionable next steps
  - print the artifact path

Acceptance:
- When Gate C blocks due to citations, inspect output is enough to proceed.

### E5-T5 — Implement `capture-fixtures` CLI subcommand
Goal: one command captures deterministic replay bundle.

Steps:
- Add `capture-fixtures` to `.opencode/pai-tools/deep-research-option-c.ts`.
- Wrap tool: `.opencode/tools/deep_research/fixture_bundle_capture.ts`.
- Output:
  - bundle id
  - bundle root
  - how to replay

Acceptance:
- After finalize, capture produces a reusable fixture bundle.

### E5-T6 — Tests + QA
Add entity tests:
- config precedence resolver behavior
- online fixtures latest pointer written
- inspect surfaces blocked urls (fixture-based)

## Progress tracker

| Task | Status | Owner | PR/Commit | Evidence |
|---|---|---|---|---|
| E5-T0 Precedence doc | TODO |  |  |  |
| E5-T1 Run-config citations | TODO |  |  |  |
| E5-T2 citations_validate precedence | TODO |  |  |  |
| E5-T3 online fixtures latest | TODO |  |  |  |
| E5-T4 inspect blocked URLs | TODO |  |  |  |
| E5-T5 capture-fixtures CLI | TODO |  |  |  |
| E5-T6 Tests | TODO |  |  |  |
| Architect PASS | TODO |  |  |  |
| QA PASS | TODO |  |  |  |

## Validator gates

### Architect gate
- Confirms precedence rules don’t break determinism.
- Confirms citations artifacts are sufficient for operator intervention + replay.

### QA gate
Run in this worktree:
```bash
cd "/private/tmp/pai-dr-epic-e5"
bun test ./.opencode/tests
bun Tools/Precommit.ts
```
