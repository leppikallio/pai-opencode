# spec-retry-policy-v1 (P02-03)

## Purpose
Define bounded retries for the stage machine.

## Source of truth
Retry caps are defined in:
- `spec-gate-escalation-v1.md`

## Rules
1. Every retry must change something material (agent swap, tighter caps, alternate validation tier).
2. Retries are counted and written into manifest.
3. After max retries, transition to failed (hard gate) or warn (soft gate) depending on gate class.

## Acceptance criteria
- Retry behavior cannot loop indefinitely.
- Retry changes are recorded for audit.

## Evidence
This file references the escalation spec and defines enforceable retry rules.
