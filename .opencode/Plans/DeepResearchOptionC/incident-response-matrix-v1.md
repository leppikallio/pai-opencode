# incident-response-matrix-v1 (P07-07)

## Run root + canonical artifacts

- `RUN_ROOT=~/.config/opencode/research-runs/<run_id>`
- `manifest.json` → `$RUN_ROOT/manifest.json`
- `gates.json` → `$RUN_ROOT/gates.json`
- `audit log` → `$RUN_ROOT/logs/audit.jsonl`
- `timeout artifacts` → `$RUN_ROOT/logs/timeouts/` and `$RUN_ROOT/logs/timeout-checkpoint.md`
- `citations pool` → `$RUN_ROOT/citations/citations.jsonl`
- `summary pack` → `$RUN_ROOT/summaries/summary-pack.json`
- `synthesis output` → `$RUN_ROOT/synthesis/final-synthesis.md`

## Offline-first diagnosis commands (rg/bun)

```bash
# 1) Manifest health snapshot
rg -n '"status"|"stage"|"revision"|"failures"' "$RUN_ROOT/manifest.json"

# 2) Gate statuses + digest visibility
rg -n '"inputs_digest"|"gates"|"status"' "$RUN_ROOT/gates.json"

# 3) Failure/event scan from audit stream
rg -n '"kind":"(timeout|tool_error|invalid_output|gate_failed)"|"error"|"blocked"' "$RUN_ROOT/logs/audit.jsonl"

# 4) Watchdog evidence scan
rg -n 'watchdog|timeout|elapsed|checkpoint|deadline' "$RUN_ROOT/logs/timeouts" "$RUN_ROOT/logs/timeout-checkpoint.md"

# 5) Citation integrity quick scan
rg -n '"cid"|"normalized_url"|"status"|"error_code"|"accessed_at"' "$RUN_ROOT/citations/citations.jsonl"

# 6) Existence check for core artifacts
bun -e 'const fs=require("node:fs");for(const p of process.argv.slice(1)){console.log(fs.existsSync(p)?"OK":"MISSING",p)}' "$RUN_ROOT/manifest.json" "$RUN_ROOT/gates.json" "$RUN_ROOT/logs/audit.jsonl" "$RUN_ROOT/citations/citations.jsonl"

# 7) Parse manifest core fields
bun -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log({revision:m.revision,status:m.status,stage:m.stage?.current,failures:(m.failures||[]).length})' "$RUN_ROOT/manifest.json"

# 8) Parse gate status map
bun -e 'const fs=require("node:fs");const g=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(Object.fromEntries(Object.entries(g.gates||{}).map(([k,v])=>[k,v.status])))' "$RUN_ROOT/gates.json"
```

## Incident response matrix

| Symptom | Likely diagnosis (offline-first) | Rollback trigger | Fallback action | Artifact paths |
|---|---|---|---|---|
| Sources blocked (`403/429/CAPTCHA`) during citation validation | Citation records show `blocked/rate_limited` concentration and repeated fetch errors in audit log | Gate C hard fail (`gates.C.status=fail`) on canary or repeated blocked-source spikes | Freeze current run, preserve artifacts, rerun with offline fixture mode / `no_web` policy, then route to standard workflow if still failing | `$RUN_ROOT/citations/citations.jsonl`; `$RUN_ROOT/gates.json`; `$RUN_ROOT/logs/audit.jsonl` |
| Provider outage (LLM/research backend unavailable) | `tool_error` events and stage stalls across multiple tasks with same provider signature | 2+ consecutive provider-related failures causing stage blockage or timeout checkpoint creation | Pause/abort Option C run, preserve artifacts, execute standard fallback research workflow | `$RUN_ROOT/manifest.json`; `$RUN_ROOT/logs/audit.jsonl`; `$RUN_ROOT/logs/timeout-checkpoint.md` |
| Wave output validator failures | Invalid JSON/schema contract drift in wave artifacts; validator errors in audit | Gate B fail persists after allowed retries | Stop downstream stages, replay deterministic fixtures, reopen only after validator pass | `$RUN_ROOT/wave-1/`; `$RUN_ROOT/wave-2/`; `$RUN_ROOT/gates.json`; `$RUN_ROOT/logs/audit.jsonl` |
| Citation integrity issues (`UNKNOWN_CID`, malformed JSONL, low coverage) | Citation graph mismatch between synthesis references and citation pool | Gate C hard fail or repeated `UNKNOWN_CID` after one regeneration attempt | Rebuild chain: extract URLs → normalize → validate → render citations report; if unresolved, rollback to standard workflow | `$RUN_ROOT/citations/citations.jsonl`; `$RUN_ROOT/citations/validated-citations.md`; `$RUN_ROOT/gates.json` |
| Watchdog timeout / silent-hang risk | Elapsed wall-clock exceeded stage timeout; timeout checkpoint emitted | Any `manifest.failures[].kind="timeout"` in canary | Mark terminal failed state, preserve run root, start fresh run from previous known-good query inputs | `$RUN_ROOT/manifest.json`; `$RUN_ROOT/logs/timeout-checkpoint.md`; `$RUN_ROOT/logs/timeouts/`; `$RUN_ROOT/logs/audit.jsonl` |
| Manifest/gates revision conflict (`expected_revision` mismatch) | Concurrent writers or stale revision usage | 2nd consecutive atomic write rejection in same stage | Quiesce writers, reload latest manifest/gates, recompute payload from current snapshot, retry once | `$RUN_ROOT/manifest.json`; `$RUN_ROOT/gates.json`; `$RUN_ROOT/logs/audit.jsonl` |
| Gate inputs-digest mismatch / drift | `gates.inputs_digest` no longer matches artifact snapshot used for decision | Digest mismatch persists after deterministic recompute | Roll back gate decision to `not_run`, regenerate from frozen artifacts, block stage advance until consistent | `$RUN_ROOT/gates.json`; `$RUN_ROOT/citations/citations.jsonl`; `$RUN_ROOT/summaries/summary-pack.json` |
| Audit stream missing/corrupted | `logs/audit.jsonl` absent, truncated, or invalid JSONL | Cannot reconstruct incident timeline from audit stream | Halt stage transitions, reconstruct minimum timeline from manifest+gates, restart append-only audit logging | `$RUN_ROOT/logs/audit.jsonl`; `$RUN_ROOT/manifest.json`; `$RUN_ROOT/gates.json` |
| Misconfigured sensitivity mode (`no_web` unintentionally set) | Manifest shows sensitivity/mode incompatible with required live retrieval | Critical stages depend on web retrieval but run policy blocks all web calls | Restart run with corrected sensitivity profile (`restricted`/`normal`) or use fully-offline fixture path intentionally | `$RUN_ROOT/manifest.json`; `$RUN_ROOT/logs/audit.jsonl` |
| Summary/synthesis artifact missing or stale | Missing summary pack or synthesis file while gates attempt D/E evaluation | Gate D/E fail due to missing required artifacts | Rebuild summary pack and synthesis from existing validated citations; keep prior failed artifacts for forensic trace | `$RUN_ROOT/summaries/summary-pack.json`; `$RUN_ROOT/synthesis/final-synthesis.md`; `$RUN_ROOT/gates.json` |

## Rollback baseline policy

1. Preserve run artifacts; never delete incident evidence automatically.
2. Record failure reason in manifest + audit.
3. If hard-gate failure persists, disable Option C path for that request and execute the standard workflow fallback.
