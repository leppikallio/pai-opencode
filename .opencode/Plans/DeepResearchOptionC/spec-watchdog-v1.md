# spec-watchdog-v1 (P02-04)

## Purpose
Guarantee “no silent hangs” by enforcing timeouts and producing explicit terminal states.

## Scope
Applies to:
- agent runs (wave agents, summarizers, reviewers)
- citation validation workers
- synthesis iterations

## Policy
1. Each stage has a max wall-clock timeout.
2. If exceeded:
   - record failure in manifest
   - block the current todo with reason
   - abort the session if needed

## Stage timeout table (v1 defaults)
| Stage | Timeout seconds |
|---|---:|
| init | 120 |
| wave1 | 600 |
| pivot | 120 |
| wave2 | 600 |
| citations | 600 |
| summaries | 600 |
| synthesis | 600 |
| review | 300 |
| finalize | 120 |

## Terminal state write (mandatory)
On timeout, orchestrator MUST:
1. Append to `manifest.failures[]`:
   - `kind = "timeout"`
   - `stage = <current>`
   - `message = "timeout after <N>s"`
   - `retryable = false` (unless explicitly configured)
2. Set `manifest.status = "failed"`.
3. Write a checkpoint artifact:
   - `logs/timeout-checkpoint.md`
   - must contain: stage, elapsed seconds, last known subtask, next steps.
4. Update session todo: mark current stage todo as `blocked` with reason + link to run root.

## Acceptance tests (future)
- Simulate a hung stage and assert:
  - manifest.status becomes failed
  - failures[] appended
  - checkpoint file exists

## Acceptance criteria
- A stage cannot exceed its timeout without producing a recorded failure.
- The user sees the failure reason and artifact path.

## Evidence
This spec defines explicit hang prevention behavior.
