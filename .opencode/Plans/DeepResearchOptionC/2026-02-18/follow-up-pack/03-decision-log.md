# Option C — Follow-up Decision Log (initial)

This file captures decisions that unblock implementation follow-ups.

## D1 — Long-run watchdog semantics

Status: OPEN

Question: In deep mode, should watchdog timeouts be based on:
- (A) time since stage start, with higher per-mode limits, or
- (B) time since last “progress heartbeat” written by orchestrator/driver?

Why it matters: default timeouts are short relative to real research runs; false failures undermine operator trust.

## D2 — Citations blocking policy

Status: OPEN

Question: When citations validation yields blocked/paywalled URLs, should the pipeline:
- (A) fail Gate C hard, or
- (B) stop in a resumable “operator action required” state (with explicit artifacts)?

Why it matters: deterministic operational behavior under blocking is required for M3.

## D3 — Gate A and Gate F

Status: OPEN

Question: Are Gate A/F intended to be enforced by tools, or are they conceptual/documentation gates?

Why it matters: readiness claims and stage transition enforcement need to match.

## D4 — Task-backed driver contract

Status: OPEN

Question: What is the minimal “production driver” contract?
- Required fields: `agent_run_id`, prompt path, raw output path, timestamps.
- Retry behavior: max attempts per perspective, must call retry recorder with change note.

Why it matters: this is the boundary between deterministic orchestration and dynamic generation.
