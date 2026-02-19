# Phase 01 Checkpoint — Independent QA Review

## Environment
- Repo: `/Users/zuul/Projects/pai-opencode-graphviz`
- Tool under test: `.opencode/tools/deep_research.ts`
- Specs:
  - `.opencode/Plans/DeepResearchOptionC/spec-tool-deep-research-run-init-v1.md`
  - `.opencode/Plans/DeepResearchOptionC/spec-tool-deep-research-manifest-write-v1.md`
  - `.opencode/Plans/DeepResearchOptionC/spec-tool-deep-research-gates-write-v1.md`

## Required checks
1) Option C enablement is settings-backed (default enabled; disable via `deepResearch.flags.PAI_DR_OPTION_C_ENABLED=false`)
2) `run_init` creates skeleton and writes `manifest.json` + `gates.json`
3) `manifest_write` bumps revision and enforces `expected_revision` mismatch
4) `manifest_write` rejects invalid status
5) `gates_write` bumps revision, requires `checked_at`, rejects hard gate `warn`
6) Run ledger JSONL gets an appended record

## Observations (evidence excerpts)

### 1) Disable behavior
```json
{"ok":false,"error":{"code":"DISABLED","message":"Deep research Option C is disabled","details":{"hint":"Set deepResearch.flags.PAI_DR_OPTION_C_ENABLED=true in .opencode/settings.json to enable."}}}
```

### 2) Enabled init creates artifacts
`run_init` returns `ok: true` with manifest + gates paths, and reports ledger written.

### 3) manifest_write optimistic lock + revision bump
Success:
```json
{"ok":true,"new_revision":2,"updated_at":"2026-02-13T20:36:31.959Z"}
```

Mismatch:
```json
{"ok":false,"error":{"code":"REVISION_MISMATCH","message":"expected_revision mismatch","details":{"expected":1,"got":2}}}
```

### 4) manifest_write rejects invalid status
```json
{"ok":false,"error":{"code":"SCHEMA_VALIDATION_FAILED","message":"manifest.status invalid","details":{}}}
```

### 5) gates_write lifecycle rules
Missing `checked_at` rejected:
```json
{"ok":false,"error":{"code":"LIFECYCLE_RULE_VIOLATION","message":"checked_at required on updates: A","details":{}}}
```

Hard gate warn rejected:
```json
{"ok":false,"error":{"code":"LIFECYCLE_RULE_VIOLATION","message":"hard gate cannot be warn: A","details":{}}}
```

### 6) Ledger append
Ledger contains an appended JSONL record including `run_id`, `root`, `session_id`, `mode`, and `sensitivity`.

## Verdict
**PASS (tool substrate behaviors checked)** — all six required checks behaved as specified.

## Not covered in this QA pass
- Invoking the tool through a real OpenCode session (`/deep-research ...`).
- Runtime installation into `~/.config/opencode`.
- Phase 02 stage engine (`stage_advance` is intentionally stubbed).
