# Authority Map Sidecar Notes

## Purpose

Keep Graphviz authority-map visuals aligned with the normative authority contract in:

- `skills/PAI/SYSTEM/DOC_AUTHORITY_MAP.md` (authoritative)

## Sidecar Artifacts

- Graph: `skills/PAI/Graphviz/authority-map.dot`
- Notes (this file): `skills/PAI/Graphviz/authority-map-notes.md`

## Rewrite Tracker References

Primary active rewrite tracker is session-local in runtime memory:

- `MEMORY/WORK/<session>/scratch/pai-coherence-mitigation-plan.md`

Relevant tracker groups for authority-map maintenance:

- `P6.9-*` (localization/review grooming)
- `P7.A*` (plan + authority stabilization)
- `P7.D*` (verification/re-review gates, including restart probes)

## Update Rule

Whenever authority ownership changes in `DOC_AUTHORITY_MAP.md`:

1. Update `authority-map.dot` nodes/edges in the same change.
2. Add/adjust tracker references in this file if maintenance scope changed.
3. Record the change in the active mitigation plan progress log.
