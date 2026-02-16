# P07-09 Operator Drills Log v1

Scope: P07-09 operator drills log created with SEC2 scan step.

---

## Drill 1 — Pause / Resume

- **Timestamp:** `YYYY-MM-DD HH:MM TZ`
- **Operator:** `<name>`
- **Run ID:** `<run_id>`

### Commands (copy/paste)

```bash
date -u
```

```bash
bun Tools/DeepResearchOptionC.ts pause --run-id "<run_id>" --reason "operator-drill-pause"
```

```bash
bun Tools/DeepResearchOptionC.ts resume --run-id "<run_id>"
```

```bash
ls -la "/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>"
```

### Expected vs Actual

- **Expected:** Run state transitions to `paused` then back to `running`; no gate regression.
- **Actual:** `<paste observed behavior>`

### Artifact paths captured

- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/manifest.json`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/gates.json`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/events.log`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' "/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>"
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

### Commands (copy/paste)

```bash
date -u
```

```bash
bun Tools/DeepResearchOptionC.ts emergency-disable --run-id "<run_id>" --reason "operator-drill-disable"
```

```bash
bun Tools/DeepResearchOptionC.ts rollback --run-id "<run_id>" --target "last-known-good"
```

```bash
bun Tools/DeepResearchOptionC.ts status --run-id "<run_id>"
```

### Expected vs Actual

- **Expected:** Emergency flag blocks further stage advancement; rollback restores prior stable revision.
- **Actual:** `<paste observed behavior>`

### Artifact paths captured

- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/manifest.json`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/rollback/`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/audit.log`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' "/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/rollback"
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

### Commands (copy/paste)

```bash
date -u
```

```bash
bun Tools/DeepResearchOptionC.ts gate-check --run-id "<run_id>" --simulate-failure "hard-gate"
```

```bash
bun Tools/DeepResearchOptionC.ts fallback --run-id "<run_id>" --mode "safe-readonly"
```

```bash
bun Tools/DeepResearchOptionC.ts status --run-id "<run_id>"
```

### Expected vs Actual

- **Expected:** Hard gate fails closed; workflow enters fallback mode with explicit reason and preserved artifacts.
- **Actual:** `<paste observed behavior>`

### Artifact paths captured

- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/gates.json`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/fallback.log`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/session-progress.json`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' "/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>"
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

### Commands (copy/paste)

```bash
date -u
```

```bash
bun Tools/DeepResearchOptionC.ts run --mode "standard" --timeout-ms 15000
```

```bash
bun Tools/DeepResearchOptionC.ts watchdog force-timeout --run-id "<run_id>"
```

```bash
bun Tools/DeepResearchOptionC.ts watchdog recover --run-id "<run_id>"
```

### Expected vs Actual

- **Expected:** Watchdog records timeout event, terminates stuck operation, and recovery path returns system to healthy idle.
- **Actual:** `<paste observed behavior>`

### Artifact paths captured

- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/watchdog.log`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/events.log`
- `/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>/run-metrics.json`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' "/Users/zuul/Projects/pai-opencode-graphviz/.opencode/DeepResearch/runs/<run_id>"
```

Paste SEC2 results:

```text
<paste SEC2 output here>
```
