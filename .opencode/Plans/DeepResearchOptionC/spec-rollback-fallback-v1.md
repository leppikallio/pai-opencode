# spec-rollback-fallback-v1 (P00-C03)

## Purpose
Defines what we do when Option C behavior is unsafe or regresses quality.

## Rollback triggers
Immediate rollback if any occurs:
- Gate C (citations) hard fail rate spikes above threshold for canary runs.
- Gate B (wave outputs) parseable rate falls below threshold.
- Silent hang detected (timeout watchdog breached) in canary.

## Rollback mechanism
- Master env flag `PAI_DR_OPTION_C_ENABLED=0` (or unset) disables Option C.
- Default route returns to existing standard research workflow.

## Fallback behavior
If Option C run fails a hard gate:
1. Preserve artifacts.
2. Emit a clear failure summary.
3. Offer fallback: run standard research workflow.

## Artifact retention
Never delete run artifacts automatically.

## Evidence
This file provides triggers + mechanism + retention rule.
