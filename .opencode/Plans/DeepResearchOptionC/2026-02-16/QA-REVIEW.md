## Verdict (PASS/FAIL)

**FAIL** — directionally correct, but not yet *testably runnable* as an operator pipeline. Key acceptance evidence is underspecified.

---

## Evidence requirements by milestone

### M1 — Offline end-to-end canary reaches `finalize`
Minimum evidence hooks:
1. A single executable smoke entrypoint (command or test) that returns non-zero on failure.
2. Run-root artifacts proving terminal state:
   - `manifest.json` shows `finalize` reached (and revision monotonicity).
   - `gates.json` shows required gates evaluated for the path taken.
   - `logs/audit.jsonl` contains ordered stage advances and writes.
3. Deterministic replay proof:
   - fixture bundle capture + replay reproduces the same outcome.
4. Negative-case proof:
   - missing/invalid artifact causes typed hard failure.

### M2 — Live Wave 1 execution (agent spawning + writing outputs)
Minimum evidence hooks:
1. A test-mode driver interface for agent execution (fixture-run compatible).
2. On-disk wave output contract proof at exact paths.
3. Retry boundedness proof (fail once, succeed on retry) with audit evidence.
4. Stage progression proof to pivot-ready.

### M3 — Pivot + Wave 2 + review loop automation
Minimum evidence hooks:
1. Pivot decision artifact persisted and explainable.
2. Wave2 artifacts written and validated.
3. Review loop boundedness proof with hard cap.
4. Gate E reporting proof and enforcement.

---

## Missing tests/fixtures

### M0 (docs milestone)
- Doc-to-tool-surface consistency test: every tool referenced in the runbook must exist in exports.
- Procedure completeness test: required procedures present and include executable snippets.

### M1
Entity contract tests:
- `run_init` root_override + skeleton + schema validity
- `stage_advance` illegal transition and missing artifact failures
- `gates_write`/`manifest_write` revision monotonicity + audit append

Fixture replay tests:
- `fixtures/runs/m1-happy-finalize/` tick-by-tick to finalize
- `fixtures/runs/m1-missing-artifact/` deterministic typed failure

Smoke test:
- `bun test .opencode/tests/smoke/m1-canary-finalize.test.ts`

### M2
Entity tests:
- `wave1_plan` caps honored
- `wave_output_validate` deterministic FAIL cases
- `wave_review` PASS/FAIL aggregation with bounded retries

Fixture replay:
- `fixtures/runs/m2-wave1-one-fail-then-retry/`

Smoke:
- `m2-wave1-fixture-run-smoke.test.ts`

### M3
Entity tests:
- `pivot_decide` determinism
- `review_factory_run` max iterations enforced
- `revision_control` prevents illegal rewrites

Fixture replay:
- `fixtures/runs/m3-review-loop-hit-cap/`

Smoke:
- `m3-fixture-run-to-finalize-smoke.test.ts`

---

## Suggested smoke run procedure

Single-command / CI-friendly definition of “runnable”:
1. Create a temp root (don’t rely on `/Users/zuul/.config/opencode/...` in CI).
2. Ensure Option C is enabled via settings (default) and run offline (`--sensitivity no_web` / fixtures). Env flags are unsupported.
3. Run the deterministic tool chain with a fixture driver that writes required artifacts.
4. Repeatedly call `stage_advance` until `finalize` or a hard gate blocks.
5. Assert: finalize reached, gates reflect mode, audit trail complete, non-zero on failure.

---

## Risk of false confidence

1. M1 “reaches finalize” without an executable smoke artifact → docs drift undetected.
2. Runtime absolute paths in acceptance evidence → works only on author machine.
3. Agent spawning without fixture driver → only live runs can validate.
4. “bounded retries” without auditable counters/caps → silent loops or no-op.
5. Stage advances without strict prerequisites → false PASS path.
6. Gates computed but not enforced → quality claims without blocking.
