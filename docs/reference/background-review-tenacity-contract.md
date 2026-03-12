# Background Review Tenacity Contract

This reference defines the parent-facing contract for background review work in PAI OpenCode hooks.

## Source Of Truth

- Parent UX is rendered from the persisted background task record in `MEMORY/STATE/background-tasks.json`.
- Launch and completion copy must come from `contract`, `progress`, `stall`, and `cancellation` state fields.
- Heuristic prose is not authoritative; state is authoritative.

## Launch Contract

Launch metadata is immutable and lives under `record.contract`:

- `kind`: `review` or `generic`
- `expectedQuietWindowMs`
- `minimumTenancyMs`
- `expectedDeliverable` (optional)
- `cancelPolicy`: `salvage-first` or `hard-cancel-ok`
- `cancellationGuardrails`
- `salvageOnCancelRequired`

Parent launch UX must include:

- quiet-analysis expectation for review tasks
- next expected update target from persisted `progress.nextExpectedUpdateByMs`
- cancellation timing from persisted guardrails and tenancy (`cancellation.minimumTenancyUntilMs`)

## Progress Semantics

Lifecycle state and progress state are separate:

- Lifecycle `status` stays canonical (`queued`, `running`, `stable_idle`, `completed`, `failed`, `cancelled`, `stale`).
- Semantic progress lives under `progress` (`phase`, productivity timestamps, deadlines, and counters).
- `nextExpectedUpdateByMs` is owned by `progress` and moves forward only.
- Productive timestamps advance only from measurable events (phase transitions, tool/counter growth, artifact/checkpoint events).

Parent completion reminders may include concise state snapshots from remaining persisted tasks (for example: phase counts and earliest next expected update deadline).

## Cancellation Guardrails

- Review tasks enforce tenancy and cancellation guardrails from persisted contract/cancellation state.
- During minimum tenancy, non-forced cancellation can be refused deterministically.
- Silence alone is not cancellation evidence for review tasks.
- Cancellation outcomes are structured and reason-coded.

## Salvage-First Behavior

- Review-task cancellation follows salvage-first policy.
- Cancellation metadata is persisted under `record.cancellation`.
- When salvage is attempted, artifact location is recorded (review path pattern: `salvage/<task_id>.json`).

## Anti-Spam Guardrails

- Launch reminder block: one block per launch, maximum three bullet lines.
- Parent fan-in messaging is coalesced to avoid repeated partial-completion spam.
- Polling cycles without state changes must not invent progress updates.
- Parent-visible update cadence follows the tenacity guardrail policy (phase changes can justify updates; unchanged state should not).
