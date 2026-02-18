# Runbook — M2 live wave1 → pivot (evidence)

## Goal

Produce an auditable run root where:
- `manifest.stage.current === "pivot"`
- Gate **B** is `pass`
- wave1 artifacts exist (`wave-1/*.md`, `wave-review.json`, `wave-1/wave1-plan.json`)

## Fast deterministic smoke (one command)

This is CI-safe (no web, no agent spawning):

```bash
cd "/private/tmp/pai-dr-epic-e6"
bun test ./.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts
```

## Manual evidence canary (interactive live driver)

### 0) Preconditions

- Export feature flags (explicit enable is required):

```bash
export PAI_DR_OPTION_C_ENABLED=1
export PAI_DR_NO_WEB=1
export PAI_DR_RUNS_ROOT="/tmp/pai-dr-runs"
```

### 1) Init

```bash
RUN_ID="m2_$(date +%Y%m%d_%H%M%S)"
bun ".opencode/pai-tools/deep-research-option-c.ts" init "M2 canary" --run-id "$RUN_ID"
```

Capture from output:
- `manifest_path: ...`
- `gates_path: ...`

### 2) Tick until pivot

Repeat until `stage.current: pivot`:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" tick --manifest "<ABS_MANIFEST>" --gates "<ABS_GATES>" --driver live --reason "canary:M2"
```

### 3) Triage on failure

If `tick.ok: false` or stage doesn’t advance:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" status --manifest "<ABS_MANIFEST>"
bun ".opencode/pai-tools/deep-research-option-c.ts" triage --manifest "<ABS_MANIFEST>"
bun ".opencode/pai-tools/deep-research-option-c.ts" inspect --manifest "<ABS_MANIFEST>"
```

Key artifacts to inspect:
- `wave-review.json`
- `logs/audit.jsonl`

## Expected artifacts checklist (minimum)

- `manifest.json` (`stage.current: pivot`)
- `gates.json` (Gate `B: pass`)
- `wave-1/wave1-plan.json`
- `wave-1/<perspective_id>.md` (>= 1)
- `wave-review.json`
- `logs/audit.jsonl`
