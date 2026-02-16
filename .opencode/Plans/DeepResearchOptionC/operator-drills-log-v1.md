# P07-09 Operator Drills Log v1

Scope: P07-09 operator drills log with reproducible tool-call/test procedures and SEC2 scan step.

Canonical run root for all drills: `~/.config/opencode/research-runs/<run_id>`

---

## Drill 1 — Pause / Resume

- **Timestamp:** `YYYY-MM-DD HH:MM TZ`
- **Operator:** `<name>`
- **Run ID:** `<run_id>`

### Procedure (copy/paste)

```bash
RUN_ID="<run_id>"
RUN_ROOT="$HOME/.config/opencode/research-runs/$RUN_ID"
date -u
```

Tool call (OpenCode):

```json
{
  "tool": "deep_research_run_init",
  "args": {
    "query": "Operator drill 1 pause/resume",
    "mode": "standard",
    "sensitivity": "no_web",
    "run_id": "<run_id>"
  }
}
```

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_manifest_write.test.ts > "$RUN_ROOT/logs/drill1-manifest-write.test.log" 2>&1
```

```bash
rg -n "set running|paused|REVISION_MISMATCH|SCHEMA_VALIDATION_FAILED" "$RUN_ROOT/logs/drill1-manifest-write.test.log"
```

### Expected vs Actual

- **Expected:** Manifest write contract shows deterministic running/paused-state behavior and revision locking.
- **Actual:** `<paste observed behavior>`

### Artifact paths captured

- `~/.config/opencode/research-runs/<run_id>/manifest.json`
- `~/.config/opencode/research-runs/<run_id>/gates.json`
- `~/.config/opencode/research-runs/<run_id>/logs/drill1-manifest-write.test.log`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' "$RUN_ROOT"
```

Paste SEC2 results:

```text
<paste SEC2 output here>
```

---

## Drill 2 — Emergency Disable / Rollback

- **Timestamp:** `YYYY-MM-DD HH:MM TZ`
- **Operator:** `<name>`
- **Run ID:** `<run_id>`

### Procedure (copy/paste)

```bash
RUN_ID="<run_id>"
RUN_ROOT="$HOME/.config/opencode/research-runs/$RUN_ID"
date -u
```

Tool call (OpenCode):

```json
{
  "tool": "deep_research_run_init",
  "args": {
    "query": "Operator drill 2 emergency-disable rollback",
    "mode": "standard",
    "sensitivity": "no_web",
    "run_id": "<run_id>"
  }
}
```

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts > "$RUN_ROOT/logs/drill2-feature-flags.test.log" 2>&1
```

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_fallback_path.test.ts > "$RUN_ROOT/logs/drill2-fallback-path.test.log" 2>&1
```

```bash
rg -n "DISABLED|master disable switch|preserve existing artifacts" "$RUN_ROOT/logs/drill2-feature-flags.test.log" "$RUN_ROOT/logs/drill2-fallback-path.test.log"
```

### Expected vs Actual

- **Expected:** Disable path blocks Option C init deterministically and rollback path preserves existing artifacts.
- **Actual:** `<paste observed behavior>`

### Artifact paths captured

- `~/.config/opencode/research-runs/<run_id>/manifest.json`
- `~/.config/opencode/research-runs/<run_id>/logs/drill2-feature-flags.test.log`
- `~/.config/opencode/research-runs/<run_id>/logs/drill2-fallback-path.test.log`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' "$RUN_ROOT"
```

Paste SEC2 results:

```text
<paste SEC2 output here>
```

---

## Drill 3 — Hard-Gate Fallback

- **Timestamp:** `YYYY-MM-DD HH:MM TZ`
- **Operator:** `<name>`
- **Run ID:** `<run_id>`

### Procedure (copy/paste)

```bash
RUN_ID="<run_id>"
RUN_ROOT="$HOME/.config/opencode/research-runs/$RUN_ID"
date -u
```

Tool call (OpenCode):

```json
{
  "tool": "deep_research_run_init",
  "args": {
    "query": "Operator drill 3 hard-gate fallback",
    "mode": "standard",
    "sensitivity": "no_web",
    "run_id": "<run_id>"
  }
}
```

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_gates_write.test.ts > "$RUN_ROOT/logs/drill3-gates-write.test.log" 2>&1
```

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts > "$RUN_ROOT/logs/drill3-fallback-offer-hard-gate.test.log" 2>&1
```

```bash
rg -n "hard gate|LIFECYCLE_RULE_VIOLATION|failed_gate_id|fallback summary" "$RUN_ROOT/logs/drill3-gates-write.test.log" "$RUN_ROOT/logs/drill3-fallback-offer-hard-gate.test.log"
```

### Expected vs Actual

- **Expected:** Hard-gate failure behavior is deterministic; fallback summary contract is generated and artifacts remain preserved.
- **Actual:** `<paste observed behavior>`

### Artifact paths captured

- `~/.config/opencode/research-runs/<run_id>/gates.json`
- `~/.config/opencode/research-runs/<run_id>/logs/drill3-gates-write.test.log`
- `~/.config/opencode/research-runs/<run_id>/logs/drill3-fallback-offer-hard-gate.test.log`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' "$RUN_ROOT"
```

Paste SEC2 results:

```text
<paste SEC2 output here>
```

---

## Drill 4 — Forced Timeout / Watchdog

- **Timestamp:** `YYYY-MM-DD HH:MM TZ`
- **Operator:** `<name>`
- **Run ID:** `<run_id>`

### Procedure (copy/paste)

```bash
RUN_ID="<run_id>"
RUN_ROOT="$HOME/.config/opencode/research-runs/$RUN_ID"
date -u
```

Tool call (OpenCode):

```json
{
  "tool": "deep_research_run_init",
  "args": {
    "query": "Operator drill 4 watchdog timeout",
    "mode": "standard",
    "sensitivity": "no_web",
    "run_id": "<run_id>"
  }
}
```

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_watchdog_check.test.ts > "$RUN_ROOT/logs/drill4-watchdog-check.test.log" 2>&1
```

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_watchdog_timeout.test.ts > "$RUN_ROOT/logs/drill4-watchdog-timeout.test.log" 2>&1
```

```bash
rg -n "timed_out|timeout-checkpoint|manifest.status|failed" "$RUN_ROOT/logs/drill4-watchdog-check.test.log" "$RUN_ROOT/logs/drill4-watchdog-timeout.test.log"
```

### Expected vs Actual

- **Expected:** Timeout watchdog behavior is deterministic: timeout detected, failure persisted, checkpoint artifacts written by contract.
- **Actual:** `<paste observed behavior>`

### Artifact paths captured

- `~/.config/opencode/research-runs/<run_id>/manifest.json`
- `~/.config/opencode/research-runs/<run_id>/logs/drill4-watchdog-check.test.log`
- `~/.config/opencode/research-runs/<run_id>/logs/drill4-watchdog-timeout.test.log`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' "$RUN_ROOT"
```

Paste SEC2 results:

```text
<paste SEC2 output here>
```
