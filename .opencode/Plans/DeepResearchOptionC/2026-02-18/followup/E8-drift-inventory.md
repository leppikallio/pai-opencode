# E8 Drift Inventory — Charter Pack Refresh

Date: 2026-02-18
Source: `../architect-review-raw-2.md`

## Drift items captured

1. **CLI location drift**
   - Charter docs referenced `Tools/deep-research-option-c.ts`.
   - Implementation reality uses `pai-tools/deep-research-option-c.ts` via:
     - `bun "pai-tools/deep-research-option-c.ts" ...`

2. **Workstream/track completion drift**
   - Charter pack lacked a concise DONE/PARTIAL/MISSING snapshot for WS/T tracks.
   - Architect raw-2 confirms multiple previously-planned tracks are already implemented.

3. **Readiness wording drift**
   - Gate B wording still called out legacy `entries[0]` behavior as an active gap.
   - Current implementation and entity tests already validate full Wave1 fan-out.

## Resolution in E8

- WS1 references updated to canonical `pai-tools/...` invocation.
- Gate B wording updated to remove stale `entries[0]` framing.
- Charter pack README now includes WS/T status snapshot with brief evidence pointers.
