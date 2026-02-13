# spec-gate-escalation-v1 (P00-B03)

## Purpose
Defines how we respond when a gate fails without getting stuck in endless loops.

## Principles
1. **Bound retries**: every gate failure has max retries.
2. **Change required**: a retry must introduce a material change.
3. **Escalate explicitly**: if still failing, stop and require operator decision.

## Decision tree

### If a HARD gate fails
1. Identify failure reason and required change.
2. Retry the minimal upstream step once.
3. If still failing, choose one:
   - downgrade mode (reduce fan-out)
   - increase validation tier (citations)
   - swap agent type (wave)
4. If still failing after 2 total retries: **STOP** and surface a checkpoint.

### If a SOFT gate fails
1. Emit warning into final output.
2. Continue pipeline.
3. Record it as a regression candidate in telemetry.

## Max retry limits (v1)
| Gate | Max retries | Notes |
|---|---:|---|
| A | 0 | planning gate should not retry; fix docs |
| B | 2 | output contract retries + agent swap |
| C | 1 | retry validation with alternate retrieval layer |
| D | 1 | re-run summarization with tighter caps |
| E | 3 | revision loop capped |
| F | 0 | rollout gate is manual |

## Evidence
This file provides a bounded escalation policy and explicit retry caps.
