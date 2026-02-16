# P07-09 Operator Drills Log v1

Scope: P07-09 operator drills log with reproducible tool-call/test procedures and SEC2 scan step.

Canonical run root for all drills: `~/.config/opencode/research-runs/operator-drill{1..4}-20260216`

---

## Drill 1 — Pause / Resume

- **Timestamp:** `2026-02-16 16:26 CET`
- **Operator:** `Marvin`
- **Run ID:** `operator-drill1-20260216`

### Procedure (copy/paste)

```bash
RUN_ID="operator-drill1-20260216"
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
    "run_id": "operator-drill1-20260216"
  }
}
```

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_manifest_write.test.ts
```

### Expected vs Actual

- **Expected:** Manifest write contract shows deterministic running/paused-state behavior and revision locking.
- **Actual:**

```text
$ PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_manifest_write.test.ts
bun test v1.3.2 (b131639c)

 3 pass
 0 fail
 22 expect() calls
Ran 3 tests across 1 file. [108.00ms]
```

### Artifact paths captured

- `bun test output (captured inline in this log)`
- `No run-root artifacts captured in this execution path (test-only drill run).`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' .opencode/Plans/DeepResearchOptionC .opencode/tools/deep_research || true
```

Paste SEC2 results:

```text
(empty output)
```

---

## Drill 2 — Emergency Disable / Rollback

- **Timestamp:** `2026-02-16 16:26 CET`
- **Operator:** `Marvin`
- **Run ID:** `operator-drill2-20260216`

### Procedure (copy/paste)

```bash
RUN_ID="operator-drill2-20260216"
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
    "run_id": "operator-drill2-20260216"
  }
}
```

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts
```

```bash
PAI_DR_OPTION_C_ENABLED=0 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_stage_advance_emergency_disable.test.ts
```

### Expected vs Actual

- **Expected:** Disable path blocks Option C init deterministically and rollback path preserves existing artifacts.
- **Actual:**

```text
$ PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_feature_flags.contract.test.ts
bun test v1.3.2 (b131639c)

 4 pass
 0 fail
Ran 4 tests across 1 file. [63.00ms]

$ PAI_DR_OPTION_C_ENABLED=0 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_stage_advance_emergency_disable.test.ts
bun test v1.3.2 (b131639c)

 1 pass
 0 fail
 6 expect() calls
Ran 1 test across 1 file. [62.00ms]
```

### Artifact paths captured

- `bun test output (captured inline in this log)`
- `No run-root artifacts captured in this execution path (test-only drill run).`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' .opencode/Plans/DeepResearchOptionC .opencode/tools/deep_research || true
```

Paste SEC2 results:

```text
(empty output)
```

---

## Drill 3 — Hard-Gate Fallback

- **Timestamp:** `2026-02-16 16:26 CET`
- **Operator:** `Marvin`
- **Run ID:** `operator-drill3-20260216`

### Procedure (copy/paste)

```bash
RUN_ID="operator-drill3-20260216"
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
    "run_id": "operator-drill3-20260216"
  }
}
```

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts
```

### Expected vs Actual

- **Expected:** Hard-gate failure behavior is deterministic; fallback summary contract is generated and artifacts remain preserved.
- **Actual:**

```text
$ PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_fallback_offer_hard_gate.test.ts
bun test v1.3.2 (b131639c)

 1 pass
 0 fail
 10 expect() calls
Ran 1 test across 1 file. [65.00ms]
```

### Artifact paths captured

- `bun test output (captured inline in this log)`
- `No run-root artifacts captured in this execution path (test-only drill run).`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' .opencode/Plans/DeepResearchOptionC .opencode/tools/deep_research || true
```

Paste SEC2 results:

```text
(empty output)
```

---

## Drill 4 — Forced Timeout / Watchdog

- **Timestamp:** `2026-02-16 16:26 CET`
- **Operator:** `Marvin`
- **Run ID:** `operator-drill4-20260216`

### Procedure (copy/paste)

```bash
RUN_ID="operator-drill4-20260216"
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
    "run_id": "operator-drill4-20260216"
  }
}
```

```bash
PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_watchdog_timeout.test.ts
```

### Expected vs Actual

- **Expected:** Timeout watchdog behavior is deterministic: timeout detected, failure persisted, checkpoint artifacts written by contract.
- **Actual:**

```text
$ PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test ./.opencode/tests/entities/deep_research_watchdog_timeout.test.ts
bun test v1.3.2 (b131639c)

 1 pass
 0 fail
 17 expect() calls
Ran 1 test across 1 file. [63.00ms]
```

### Artifact paths captured

- `bun test output (captured inline in this log)`
- `No run-root artifacts captured in this execution path (test-only drill run).`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' .opencode/Plans/DeepResearchOptionC .opencode/tools/deep_research || true
```

Paste SEC2 results:

```text
(empty output)
```
