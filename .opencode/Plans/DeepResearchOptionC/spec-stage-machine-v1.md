# spec-stage-machine-v1 (P02-01)

## Purpose
Define the deterministic stage machine for Option C.

## Stage IDs (must match `spec-manifest-schema-v1.md`)
- init
- wave1
- pivot
- wave2
- citations
- summaries
- synthesis
- review
- finalize

## Transition table (v1)
| From | To | Preconditions | On-fail |
|---|---|---|---|
| init | wave1 | manifest valid; perspectives.json generated | fail run (hard) |
| wave1 | pivot | wave1 artifacts exist; **Gate B pass** (after bounded retries) | stop (hard) |
| pivot | wave2 | pivot decision says wave2 | skip wave2 |
| pivot | citations | pivot decision complete | fail run (hard) |
| wave2 | citations | wave2 artifacts exist OR wave2 skipped | continue |
| citations | summaries | Gate C pass | stop (hard) |
| summaries | synthesis | Gate D pass | stop (hard) |
| synthesis | review | draft exists | stop (hard) |
| review | synthesis | reviewer says CHANGES_REQUIRED; iterations < max | continue |
| review | finalize | Gate E hard metrics pass | stop (hard) |
| review | (terminal failed) | Gate E hard metrics fail; iterations >= max | fail run (hard) |

## Terminal states
- completed: finalize reached
- failed: hard gate fail or unrecoverable error
- cancelled: user abort
- paused: manual pause requested

## Determinism rules
1. Stage transitions are driven only by artifacts + manifest state.
2. Same inputs must yield the same next stage decision.

## Acceptance criteria
- Transition table covers every stage.
- Preconditions map to specific artifacts/gates.

## Evidence
This spec contains a complete transition table + determinism rules.
