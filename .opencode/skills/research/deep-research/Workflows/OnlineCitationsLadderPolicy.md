# Workflow: OnlineCitationsLadderPolicy

Choose and enforce the citations validation ladder based on run sensitivity.

## Policy

- `sensitivity=no_web` -> offline citations validation only.
- `sensitivity=normal|restricted` -> online citations validation required.

## Ladder behavior

1. Extract candidate URLs (`citations_extract_urls`).
2. Normalize URLs + CIDs (`citations_normalize`).
3. Validate citations (`citations_validate`):
   - offline fixtures in no-web mode
   - online validation in normal/restricted mode
4. Compute Gate C (`gate_c_compute`) and persist with `gates_write`.

## Blocked URL handling

- Treat blocked URLs as first-class artifacts; never hide them.
- If blocked URLs are non-zero, emit operator directive with remediation action before retry.
- Keep retry decisions bounded and auditable.

## Artifacts to inspect

- `blocked-urls.json` in the run's citations directory
- `online-fixtures.latest.json` in the run's citations directory (stable pointer when available)
- timestamped online fixtures reported by `citations_validate` (`online-fixtures.<ts>.json` in citations directory)
- `citations.jsonl` in the run's citations directory

## Validation contract (Gate C)

- [ ] In online modes, citations validation writes `citations.jsonl` plus online fixtures artifacts.
- [ ] In online modes, `blocked-urls.json` exists (empty `items` is acceptable).
- [ ] In offline mode, deterministic offline fixtures path is provided to `citations_validate`.
- [ ] `gate_c_compute` emits a complete gate patch and `gates_write` persists it.
- [ ] Stage advances from `citations` to `summaries` only after Gate C write succeeds.
