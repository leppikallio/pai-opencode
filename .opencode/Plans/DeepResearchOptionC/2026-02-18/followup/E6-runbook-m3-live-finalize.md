# Runbook — M3 live finalize (evidence)

## Goal

Produce an auditable run root where:
- `manifest.stage.current === "finalize"`
- `manifest.status === "completed"`
- Gate **E** is `pass`
- Phase 05 artifacts exist (generate mode)

## Fast deterministic smoke (one command)

This is CI-safe (no web, no agent spawning):

```bash
cd "/private/tmp/pai-dr-epic-e6"
bun test ./.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts
```

## Manual evidence canary (interactive live driver)

### 0) Preconditions

At minimum (explicit enable is required):

```bash
export PAI_DR_OPTION_C_ENABLED=1
export PAI_DR_RUNS_ROOT="/tmp/pai-dr-runs"
```

For offline-only scaffolding (recommended until online ladder is ready):

```bash
export PAI_DR_NO_WEB=1
```

For true online M3 (citations ladder):

```bash
export PAI_DR_NO_WEB=0
export PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT="<your brightdata citations endpoint>"
export PAI_DR_CITATIONS_APIFY_ENDPOINT="<your apify citations endpoint>"
```

### 1) Init

```bash
RUN_ID="m3_$(date +%Y%m%d_%H%M%S)"
bun ".opencode/pai-tools/deep-research-option-c.ts" init "M3 canary" --run-id "$RUN_ID"
```

Capture from output:
- `manifest_path: ...`
- `gates_path: ...`

### 2) Tick until finalize

Repeat until `stage.current: finalize` and `status: completed`:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" tick --manifest "<ABS_MANIFEST>" --gates "<ABS_GATES>" --driver live --reason "canary:M3"
```

### 3) Triage on failure

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" triage --manifest "<ABS_MANIFEST>"
bun ".opencode/pai-tools/deep-research-option-c.ts" inspect --manifest "<ABS_MANIFEST>"
```

If blocked at citations:
- `citations/blocked-urls.json` (if present)
- `citations/found-by.json`
- `citations/online-fixtures.latest.json`

### 4) Capture reproducibility artifacts

If the operator CLI includes `capture-fixtures` (Epic E5):

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" capture-fixtures --manifest "<ABS_MANIFEST>" --reason "canary:M3 fixture capture"
```

Fallback (tool-level) if CLI command is unavailable:
- Use `deep_research_fixture_bundle_capture` directly (or the integration runbook once merged).

## Expected artifacts checklist (minimum)

- `manifest.json` (`stage.current: finalize`, `status: completed`)
- `gates.json` (Gate `E: pass`)
- `summaries/summary-pack.json`
- `synthesis/final-synthesis.md`
- `review/review-bundle.json`
- `reports/gate-e-status.json` (pass)
- `logs/audit.jsonl`
