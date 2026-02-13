# spec-dry-run-v1 (P02-05)

## Purpose
Allow deterministic testing without web access or provider variability.

## Dry-run mode definition
- No external web tools.
- Uses fixture artifacts for wave outputs and citation pools.
- Still runs:
  - parsing
  - gates
  - summary pack creation
  - synthesis+review loops (optionally with stubbed LLM outputs)

## Fixture layout (v1)
```text
fixtures/dry-run/<case-id>/
  manifest.json (seed)
  wave-1/
  wave-2/
  citations/
  expected-gates.json
```

## Acceptance criteria
- A dry-run produces `gates.json` and `synthesis/final-synthesis.md`.
- Gate failures are reproducible.

## Evidence
This file defines fixture layout and dry-run rules.
