# Deep Research Option C — Dependency DAG (v1)

Date: 2026-02-18

This DAG encodes sequencing so we can parallelize safely and avoid false “progress”.

## Mermaid DAG

```mermaid
graph TD
  A[Gate A: Tool wiring PASS] --> O1[WS1: Operator CLI + unified run loop]
  A --> W1[WS2: Live Wave1 fan-out + retry consumption]
  A --> P1[WS3: Pivot routing + Wave2 orchestration]
  A --> C1[WS4: Online citations + reproducibility]
  A --> S1[WS5: Phase05 generate mode]
  A --> L1[WS6: Long-run ops (lock/pause/watchdog/telemetry)]

  O1 --> M2[M2 evidence run: live wave1->pivot]
  W1 --> M2

  M2 --> P1
  P1 --> M3a[M3a evidence: pivot->summaries with online citations]
  C1 --> M3a

  M3a --> S1
  S1 --> M3b[M3b evidence: summaries->finalize in generate mode]

  L1 --> M3b
  M3b --> READY["Production-ready" claim]
```

## Notes on parallelism

- WS1 (operator CLI) and WS2 (wave1 fan-out) can run in parallel but must converge before M2.
- WS3 (wave2) can start early, but correctness depends on having a consistent operator loop and wave1/pivot artifacts.
- WS4 (online citations) can be implemented in parallel, but must be exercised as part of M3a.
- WS5 (generate mode) is the largest functional blocker for M3b.
- WS6 (ops hardening) must land before we claim long-run readiness.

## Integration checkpoints

At each milestone (M2, M3a, M3b):

- produce the evidence run root path
- enumerate required artifacts (see readiness gates)
- run repo checks (`bun test`, `precommit`)
- run Architect + QA review on the delta touching operator surface and lifecycle behavior
