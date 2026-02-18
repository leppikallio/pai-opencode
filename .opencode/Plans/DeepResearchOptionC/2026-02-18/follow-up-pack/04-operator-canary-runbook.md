# Option C — Operator Canary Runbook (draft)

This is a runbook for creating evidence runs for M2/M3.

## Canary 1 — M2 (Wave1 → Pivot)

1) Init:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" init "<query>" --mode standard --sensitivity normal
```

2) Run until blocked or pivot:

```bash
# Use the manifest/gates paths printed by init
bun ".opencode/pai-tools/deep-research-option-c.ts" run --manifest "<abs>" --gates "<abs>" --driver live --reason "canary:M2" --max-ticks 50
```

3) If blocked:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" triage --manifest "<abs>" --gates "<abs>"
```

4) Evidence to capture:
- Run root path
- `manifest.json`, `gates.json`
- `wave-1/` outputs and `wave-review.json`

## Canary 2 — M3 (End-to-end finalize)

1) Start from an M2-complete run root (or a fresh init).

2) Run:

```bash
bun ".opencode/pai-tools/deep-research-option-c.ts" run --manifest "<abs>" --gates "<abs>" --driver live --reason "canary:M3" --max-ticks 200
```

3) If blocked at citations:
- Inspect `citations/blocked-urls.json` and decide next action (replace URLs vs escalate ladder vs accept paywalls per policy).

4) Evidence to capture:
- `citations/` artifacts (jsonl + fixtures + blocked list)
- `summaries/`, `synthesis/`, `review/`, `reports/`
- `logs/audit.jsonl`

## Notes

- Today, live driver may be operator-input; once WS-A lands, this runbook should be updated to autonomous Task-backed execution.
