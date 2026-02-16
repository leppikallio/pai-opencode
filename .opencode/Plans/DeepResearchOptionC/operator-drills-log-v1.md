# P07-09 Operator Drills Log v1

Scope: P07-09 operator drills log with reproducible tool-call/test procedures and SEC2 scan step.

Canonical run root for all drills: `~/.config/opencode/research-runs/operator-drill{1..4}-20260216`

## Run-root artifact capture (evidence)

- **Timestamp:** `2026-02-16 17:10 CET`
- **Operator:** `Marvin`

Prereqs (copy/paste):

```bash
export PAI_DR_OPTION_C_ENABLED=1
mkdir -p "$HOME/.config/opencode/research-runs"
```

Run-root trees captured:

```text
===== operator-drill1-20260216
$HOME/.config/opencode/research-runs/operator-drill1-20260216
├── citations
├── gates.json
├── logs
├── manifest.json
├── summaries
├── synthesis
├── wave-1
└── wave-2
===== operator-drill2-20260216
$HOME/.config/opencode/research-runs/operator-drill2-20260216
├── citations
├── gates.json
├── logs
├── manifest.json
├── summaries
├── synthesis
├── wave-1
└── wave-2
===== operator-drill3-20260216
$HOME/.config/opencode/research-runs/operator-drill3-20260216
├── citations
├── gates.json
├── logs
├── manifest.json
├── summaries
├── synthesis
├── wave-1
└── wave-2
===== operator-drill4-20260216
$HOME/.config/opencode/research-runs/operator-drill4-20260216
├── citations
├── gates.json
├── logs
├── manifest.json
├── summaries
├── synthesis
├── wave-1
└── wave-2
```

SEC2 scan results (credential-bearing URL/token patterns):

```text
(empty output)
```

---

## Drill 1 — Pause / Resume

- **Timestamp:** `2026-02-16 16:26 CET`
- **Operator:** `Marvin`
- **Run ID:** `operator-drill1-20260216`

### Procedure (copy/paste)

```bash
RUN_ID="operator-drill1-20260216"
RUN_ROOT="$HOME/.config/opencode/research-runs/$RUN_ID"
export PAI_DR_OPTION_C_ENABLED=1
export PAI_DR_NO_WEB=1
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
- Run-root artifacts captured under `$RUN_ROOT` (see **Run-root artifact capture** section above).
- Key files:
  - `$RUN_ROOT/manifest.json`
  - `$RUN_ROOT/gates.json`

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
export PAI_DR_OPTION_C_ENABLED=1
export PAI_DR_NO_WEB=1
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
- Run-root artifacts captured under `$RUN_ROOT` (see **Run-root artifact capture** section above).
- Key files:
  - `$RUN_ROOT/manifest.json`
  - `$RUN_ROOT/gates.json`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' .opencode/Plans/DeepResearchOptionC .opencode/tools/deep_research || true
```

Paste SEC2 results:

```text
(empty output)
```

---

## Drill 5 — Deterministic Dry-Run Seed + Run-Root Artifact Capture

- **Timestamp:** `2026-02-16 16:50 CET`
- **Operator:** `Marvin`
- **Run ID:** `operator-drill5-case-minimal-20260216`

### Procedure (copy/paste)

```bash
RUN_ID="operator-drill5-case-minimal-20260216"
RUN_ROOT="$HOME/.config/opencode/research-runs/$RUN_ID"
FIXTURE_DIR="$PWD/.opencode/tests/fixtures/dry-run/case-minimal"
BUNDLE_ROOT="$HOME/.config/opencode/research-runs/fixture-bundles"
export PAI_DR_OPTION_C_ENABLED=1
export PAI_DR_NO_WEB=1
date -u
```

Tool call (OpenCode) — deterministic no-web fixture seed:

```json
{
  "tool": "deep_research_dry_run_seed",
  "args": {
    "fixture_dir": "$FIXTURE_DIR",
    "run_id": "operator-drill5-case-minimal-20260216",
    "reason": "operator drill 5 deterministic seed",
    "root_override": "$HOME/.config/opencode/research-runs"
  }
}
```

Tool call (OpenCode) — deterministic stage transition (`init -> wave1`):

```json
{
  "tool": "deep_research_stage_advance",
  "args": {
    "manifest_path": "$RUN_ROOT/manifest.json",
    "gates_path": "$RUN_ROOT/gates.json",
    "requested_next": "wave1",
    "reason": "operator drill 5 stage-advance smoke"
  }
}
```

Artifact capture (copy/paste):

```bash
for p in \
  "$RUN_ROOT/manifest.json" \
  "$RUN_ROOT/gates.json" \
  "$RUN_ROOT/wave-1" \
  "$RUN_ROOT/wave-2" \
  "$RUN_ROOT/citations" \
  "$RUN_ROOT/citations/citations.jsonl" \
  "$RUN_ROOT/summaries" \
  "$RUN_ROOT/summaries/summary-pack.json" \
  "$RUN_ROOT/synthesis" \
  "$RUN_ROOT/synthesis/final-synthesis.md" \
  "$RUN_ROOT/reports/gate-e-status.json" \
  "$RUN_ROOT/reports/gate-e-citation-utilization.json" \
  "$RUN_ROOT/reports/gate-e-numeric-claims.json" \
  "$RUN_ROOT/reports/gate-e-sections-present.json"; do
  if [ -e "$p" ]; then
    echo "FOUND $p"
  else
    echo "MISSING (if not yet produced in this stage): $p"
  fi
done
```

Optional bundle capture (replayable fixture):

```json
{
  "tool": "deep_research_fixture_bundle_capture",
  "args": {
    "manifest_path": "$RUN_ROOT/manifest.json",
    "output_dir": "$BUNDLE_ROOT",
    "bundle_id": "operator-drill5-case-minimal",
    "reason": "operator drill 5 bundle capture"
  }
}
```

### Artifact paths captured

- `$HOME/.config/opencode/research-runs/$RUN_ID/manifest.json`
- `$HOME/.config/opencode/research-runs/$RUN_ID/gates.json`
- `$HOME/.config/opencode/research-runs/$RUN_ID/wave-1/` (fixture `case-minimal` seeds `p1.md`)
- `$HOME/.config/opencode/research-runs/$RUN_ID/wave-2/` (created at init; content stage-dependent)
- `$HOME/.config/opencode/research-runs/$RUN_ID/citations/` and `$HOME/.config/opencode/research-runs/$RUN_ID/citations/citations.jsonl` (if generated)
- `$HOME/.config/opencode/research-runs/$RUN_ID/summaries/` and `$HOME/.config/opencode/research-runs/$RUN_ID/summaries/summary-pack.json` (if generated)
- `$HOME/.config/opencode/research-runs/$RUN_ID/synthesis/` and `$HOME/.config/opencode/research-runs/$RUN_ID/synthesis/final-synthesis.md` (if generated)
- `$HOME/.config/opencode/research-runs/$RUN_ID/reports/gate-e-status.json` (if generated)
- `$HOME/.config/opencode/research-runs/$RUN_ID/reports/gate-e-citation-utilization.json` (if generated)
- `$HOME/.config/opencode/research-runs/$RUN_ID/reports/gate-e-numeric-claims.json` (if generated)
- `$HOME/.config/opencode/research-runs/$RUN_ID/reports/gate-e-sections-present.json` (if generated)
- `$HOME/.config/opencode/research-runs/fixture-bundles/operator-drill5-case-minimal/bundle.json` (optional bundle output)

### Expected vs Actual

- **Expected:** Run root is created under `$HOME/.config/opencode/research-runs/$RUN_ID`, seeded from `case-minimal` with deterministic no-web constraints, and artifact paths are enumerated as `FOUND` or `MISSING`.

- **Actual (tool outputs):**

```text
RUN_ID=operator-drill5-case-minimal-20260216
RUN_ROOT=/Users/zuul/.config/opencode/research-runs/operator-drill5-case-minimal-20260216
=== deep_research_dry_run_seed ===
{
  "ok": true,
  "run_id": "operator-drill5-case-minimal-20260216",
  "root": "/Users/zuul/.config/opencode/research-runs/operator-drill5-case-minimal-20260216",
  "manifest_path": "/Users/zuul/.config/opencode/research-runs/operator-drill5-case-minimal-20260216/manifest.json",
  "gates_path": "/Users/zuul/.config/opencode/research-runs/operator-drill5-case-minimal-20260216/gates.json",
  "root_override": "/Users/zuul/.config/opencode/research-runs",
  "copied": {
    "roots": [
      "citations",
      "wave-1"
    ],
    "entries": [
      "citations/.gitkeep",
      "wave-1/p1.md"
    ]
  },
  "dry_run": {
    "fixture_dir": "/Users/zuul/Projects/pai-opencode-graphviz/.opencode/tests/fixtures/dry-run/case-minimal",
    "case_id": "case-minimal"
  },
  "manifest_revision": 2
}
=== deep_research_stage_advance init->wave1 ===
{
  "ok": false,
  "error": {
    "code": "MISSING_ARTIFACT",
    "message": "perspectives.json missing",
    "details": {
      "file": "perspectives.json",
      "from": "init",
      "to": "wave1",
      "decision": {
        "allowed": false,
        "evaluated": [
          {
            "kind": "transition",
            "name": "init -> wave1",
            "ok": true,
            "details": {}
          },
          {
            "kind": "artifact",
            "name": "perspectives.json",
            "ok": false,
            "details": {
              "path": "/Users/zuul/.config/opencode/research-runs/operator-drill5-case-minimal-20260216/perspectives.json"
            }
          }
        ],
        "inputs_digest": "sha256:19b440fa1fe75edfefd8110165d30b2ef944109373b14ba0b1af78207de3c756"
      }
    }
  }
}
```

- **Actual (run-root tree):**

```text
/Users/zuul/.config/opencode/research-runs/operator-drill5-case-minimal-20260216
├── citations
├── gates.json
├── logs
│   └── audit.jsonl
├── manifest.json
├── summaries
├── synthesis
├── wave-1
│   └── p1.md
└── wave-2
```

- **Actual (key files):**

```text
wave-1/p1.md (57 bytes)
citations/.gitkeep (0 bytes)
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
export PAI_DR_OPTION_C_ENABLED=1
export PAI_DR_NO_WEB=1
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
- Run-root artifacts captured under `$RUN_ROOT` (see **Run-root artifact capture** section above).
- Key files:
  - `$RUN_ROOT/manifest.json`
  - `$RUN_ROOT/gates.json`

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
export PAI_DR_OPTION_C_ENABLED=1
export PAI_DR_NO_WEB=1
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
- Run-root artifacts captured under `$RUN_ROOT` (see **Run-root artifact capture** section above).
- Key files:
  - `$RUN_ROOT/manifest.json`
  - `$RUN_ROOT/gates.json`

### SEC2 scan step

```bash
rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)' .opencode/Plans/DeepResearchOptionC .opencode/tools/deep_research || true
```

Paste SEC2 results:

```text
(empty output)
```
