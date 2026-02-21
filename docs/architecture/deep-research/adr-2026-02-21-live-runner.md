# ADR 2026-02-21: Live runner seam beyond Wave 1

## Status

Accepted

## Context

Option C currently supports a `runAgent` seam for Wave 1, while later stages depend on task-seam artifacts being written by an operator flow. In live operation this creates avoidable stalls when Wave 2 artifacts are missing, even though the system already has enough context to request agent output.

We want Phase 1C to reduce operator burden without removing the existing safe path.

## Decision

Define "live automation" as: when `driver="live"` and required stage artifacts are missing, the orchestrator may call a pluggable `runAgent` seam to produce those artifacts and continue execution.

For this phase, we extend the seam past Wave 1 by enabling Wave 2 to request missing perspective outputs through `runAgent`.

Key properties:

- **Pluggable seam:** orchestration accepts injected drivers; live automation is opt-in by driver selection.
- **Fallback preserved:** task-seam flows remain available and unchanged for operator-driven execution.
- **Minimal surface area:** only add wiring needed to invoke `runAgent` for Wave 2 missing outputs.

## Why extend the seam

1. **Reduces manual intervention:** live runs no longer halt solely because Wave 2 output files are absent.
2. **Keeps architecture consistent:** Wave 1 and post-pivot stages share a common execution model.
3. **Improves reliability by design:** deterministic orchestration still controls prompts, paths, and validation, while agent invocation is encapsulated in one seam.

## Non-goals

- No OpenCode runtime/platform changes.
- No hidden background daemon/process model.
- No removal of task-driver artifact ingestion path.
- No broad refactor of unrelated orchestrator stages in this ADR.

## Failure modes and fallback behavior

### 1) `runAgent` unavailable or errors in live mode

- **Behavior:** return a structured error for the stage invocation.
- **Fallback:** operator can continue through task seam by providing required artifacts explicitly.

### 2) Agent output fails markdown contract/validation

- **Behavior:** stage keeps validation gate behavior; invalid artifacts do not silently advance.
- **Fallback:** operator can correct via task seam artifacts and re-tick.

### 3) Partial artifact creation

- **Behavior:** orchestration only advances when required outputs are present and validated.
- **Fallback:** rerun live tick (if recoverable) or use task seam for missing pieces.

## Consequences

- Live mode gains autonomy for Wave 2 without changing default safety semantics.
- Driver semantics become clearer: `task` remains explicit/manual-safe, `live` can actively produce missing artifacts via injected seam.
- Future phases can reuse this seam pattern for summaries/synthesis without coupling to a single execution backend.
