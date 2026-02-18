# Deep Research Option C — Follow-up Plans (derived)

These plans are derived from (do **not** edit these sources):
- `../engineer-review-raw-2.md`
- `../architect-review-raw-2.md`

Goal: convert the reviews into an execution-ready backlog with dependencies, acceptance tests, and validator gates.

Docs:
- `00-master.md` — master plan + dependency DAG
- `01-epic-production-runagent-driver.md` — Task-backed autonomous `runAgent` driver
- `02-epic-cli-ergonomics.md` — run-id-first, `--until`, `cancel`, better inspect/triage
- `03-epic-longrun-timeouts.md` — 1h+ safety semantics (mode timeouts or progress heartbeat)
- `04-epic-observability.md` — tick ledger + telemetry/metrics defaults
- `05-epic-config-and-citations.md` — config precedence + citations operator guidance + fixture capture
- `06-epic-smoke-tests-canary.md` — executable M2/M3 canaries + runbooks
- `07-epic-skill-deep-research-production.md` — new skill for production prompting/policy
- `08-epic-charter-pack-refresh.md` — refresh charter-pack docs to match implementation

## Repo + worktrees (created for parallel execution)

Repo root:
- `/Users/zuul/Projects/pai-opencode-graphviz`

Temporary worktrees (one per epic):
- E1: `/private/tmp/pai-dr-epic-e1` (branch `ws/epic-e1-runagent-driver`)
- E2: `/private/tmp/pai-dr-epic-e2` (branch `ws/epic-e2-cli-ergonomics`)
- E3: `/private/tmp/pai-dr-epic-e3` (branch `ws/epic-e3-longrun-timeouts`)
- E4: `/private/tmp/pai-dr-epic-e4` (branch `ws/epic-e4-observability`)
- E5: `/private/tmp/pai-dr-epic-e5` (branch `ws/epic-e5-config-citations`)
- E6: `/private/tmp/pai-dr-epic-e6` (branch `ws/epic-e6-canaries`)
- E7: `/private/tmp/pai-dr-epic-e7` (branch `ws/epic-e7-production-skill`)
- E8: `/private/tmp/pai-dr-epic-e8` (branch `ws/epic-e8-charter-refresh`)

Integration back to `graphviz` is described in `90-integration-and-final-review.md`.
