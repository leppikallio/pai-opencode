# spec-gates-schema-v1 (P00-A02)

## Purpose
Defines the canonical per-run **gate state file**.

This is separate from `manifest.json`:
- manifest = lifecycle + pointers
- gates = pass/fail decisions + metrics snapshots

## File
- Path (per run, default): `~/.config/opencode/research-runs/<run_id>/gates.json`
- Format: JSON

## Fields (v1)

### Top-level
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `schema_version` | string | ✅ | fixed: `gates.v1` |
| `run_id` | string | ✅ | matches manifest |
| `revision` | number | ✅ | monotonic counter (increments on every write) |
| `updated_at` | string | ✅ | ISO timestamp |
| `inputs_digest` | string | ✅ | hash of the inputs used to compute gates |
| `gates` | object | ✅ | keyed by Gate ID |

### `gates.<GATE_ID>`
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `id` | string | ✅ | e.g., `A`, `B`, ... |
| `name` | string | ✅ | human label |
| `class` | string | ✅ | `hard|soft` |
| `status` | string | ✅ | hard: `not_run|pass|fail`; soft: `not_run|pass|fail|warn` |
| `checked_at` | string | null | ✅ | ISO timestamp; may be `null` when `status=not_run` |
| `metrics` | object | ✅ | arbitrary numeric/string metrics |
| `artifacts` | array | ✅ | list of artifact paths used |
| `warnings` | array | ✅ | machine-readable warnings (soft metric failures) |
| `notes` | string | ✅ | short rationale |

### Required Gate IDs (v1)
The `gates` object MUST include entries for all gate IDs:
- `A`, `B`, `C`, `D`, `E`, `F`

## Lifecycle rules
1. A hard gate may only be `pass` or `fail` (never `warn`).
2. A soft gate may be `warn`.
3. Hard gates may still emit `warnings[]` while remaining `status=pass`.
4. Any `fail` on a hard gate blocks downstream stages.
5. Gate checks must be repeatable (same inputs => same status).

## Minimal JSON example
```json
{
  "schema_version": "gates.v1",
  "run_id": "dr_20260213_001",
  "revision": 1,
  "updated_at": "2026-02-13T12:30:00Z",
  "inputs_digest": "sha256:...",
  "gates": {
    "A": {
      "id": "A",
      "name": "Planning completeness",
      "class": "hard",
      "status": "pass",
      "checked_at": "2026-02-13T12:30:00Z",
      "metrics": { "schemas_defined": 5, "rubrics_defined": 6 },
      "artifacts": ["spec-manifest-schema-v1.md", "spec-reviewer-rubrics-v1.md"],
      "warnings": [],
      "notes": "All required planning artifacts present and versioned."
    },
    "B": { "id": "B", "name": "Wave output contract compliance", "class": "hard", "status": "not_run", "checked_at": null, "metrics": {}, "artifacts": [], "warnings": [], "notes": "" },
    "C": { "id": "C", "name": "Citation validation integrity", "class": "hard", "status": "not_run", "checked_at": null, "metrics": {}, "artifacts": [], "warnings": [], "notes": "" },
    "D": { "id": "D", "name": "Summary pack boundedness", "class": "hard", "status": "not_run", "checked_at": null, "metrics": {}, "artifacts": [], "warnings": [], "notes": "" },
    "E": { "id": "E", "name": "Synthesis quality", "class": "hard", "status": "not_run", "checked_at": null, "metrics": {}, "artifacts": [], "warnings": [], "notes": "" },
    "F": { "id": "F", "name": "Rollout safety", "class": "hard", "status": "not_run", "checked_at": null, "metrics": {}, "artifacts": [], "warnings": [], "notes": "" }
    }
  }
}
```

## Evidence (P00-A02)
This file includes:
- schema table,
- lifecycle rules,
- a concrete JSON example.
