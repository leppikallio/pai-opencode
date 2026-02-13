# spec-manifest-schema-v1 (P00-A01)

## Purpose
Defines the canonical **run manifest** for Option C Deep Research runs.

The manifest is the **resume anchor**: if everything else is lost, the run can be reconstructed from this file + artifact directory.

## File
- Path (per run): `scratch/research-runs/<run_id>/manifest.json`
- Format: JSON
- Update rule: atomic write (never partial). Every write increments `revision`.

## Invariants (must always hold)
1. `run_id` is immutable.
2. `status` is one of: `created | running | paused | failed | completed | cancelled`.
3. `stage.current` is one of the allowed stage IDs.
4. `artifacts.root` is absolute and points to this run directory.
5. `revision` increments by exactly 1 per write.

## Fields (v1)

### Top-level
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `schema_version` | string | ✅ | fixed: `manifest.v1` |
| `run_id` | string | ✅ | stable identifier |
| `created_at` | string | ✅ | ISO timestamp |
| `updated_at` | string | ✅ | ISO timestamp |
| `revision` | number | ✅ | monotonic counter |
| `query` | object | ✅ | user query + constraints |
| `mode` | string | ✅ | `quick|standard|deep` (Option C still supports modes) |
| `status` | string | ✅ | lifecycle status |
| `stage` | object | ✅ | stage machine state |
| `limits` | object | ✅ | fan-out caps, budget caps |
| `agents` | object | ✅ | agent allocations, tool policy |
| `artifacts` | object | ✅ | root + canonical subpaths |
| `metrics` | object | ✅ | live counters + gate outputs |
| `failures` | array | ✅ | failure records (may be empty) |

### `query`
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `text` | string | ✅ | verbatim user query |
| `constraints` | object | ❌ | optional: time horizon, domains, sources |
| `sensitivity` | string | ❌ | optional: `normal|restricted|no_web` |

### `stage`
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `current` | string | ✅ | current stage id |
| `started_at` | string | ✅ | ISO timestamp |
| `history` | array | ✅ | append-only stage transitions |

#### `stage.history[]` entry schema
Each entry MUST be an object with:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `from` | string | ✅ | prior stage id |
| `to` | string | ✅ | next stage id |
| `ts` | string | ✅ | ISO timestamp |
| `reason` | string | ✅ | short audit reason |
| `inputs_digest` | string | ✅ | digest of inputs used for decision |
| `gates_revision` | number | ✅ | gates.json revision at decision time |

Allowed stage IDs (v1):
- `init`
- `wave1`
- `pivot`
- `wave2`
- `citations`
- `summaries`
- `synthesis`
- `review`
- `finalize`

### `limits`
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `max_wave1_agents` | number | ✅ | hard cap |
| `max_wave2_agents` | number | ✅ | hard cap |
| `max_summary_kb` | number | ✅ | per-summary cap |
| `max_total_summary_kb` | number | ✅ | pack cap |
| `max_review_iterations` | number | ✅ | hard cap |

### `artifacts`
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `root` | string | ✅ | run dir |
| `paths` | object | ✅ | canonical subpaths |

Canonical paths (keys):
- `wave1_dir`, `wave2_dir`
- `citations_dir`
- `summaries_dir`
- `synthesis_dir`
- `logs_dir`
- `gates_file` (points to `gates.json`)

Canonical artifact pointers (keys):
- `perspectives_file` (points to `perspectives.json`)
- `citations_file` (points to `citations/citations.jsonl`)
- `summary_pack_file` (points to `summaries/summary-pack.json`)
- `pivot_file` (points to `pivot.json`)

### `failures[]`
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ts` | string | ✅ | ISO timestamp |
| `stage` | string | ✅ | stage where it happened |
| `kind` | string | ✅ | `timeout|tool_error|invalid_output|gate_failed|unknown` |
| `message` | string | ✅ | human readable |
| `retryable` | boolean | ✅ | |

## Minimal JSON example
```json
{
  "schema_version": "manifest.v1",
  "run_id": "dr_20260213_001",
  "created_at": "2026-02-13T12:00:00Z",
  "updated_at": "2026-02-13T12:00:00Z",
  "revision": 1,
  "query": { "text": "Research X", "constraints": {}, "sensitivity": "normal" },
  "mode": "standard",
  "status": "created",
  "stage": { "current": "init", "started_at": "2026-02-13T12:00:00Z", "history": [] },
  "limits": {
    "max_wave1_agents": 6,
    "max_wave2_agents": 6,
    "max_summary_kb": 5,
    "max_total_summary_kb": 60,
    "max_review_iterations": 4
  },
  "agents": { "policy": "existing-runtime-only" },
  "artifacts": {
    "root": "/abs/path/scratch/research-runs/dr_20260213_001",
    "paths": {
      "wave1_dir": "wave-1",
      "wave2_dir": "wave-2",
      "citations_dir": "citations",
      "summaries_dir": "summaries",
      "synthesis_dir": "synthesis",
      "logs_dir": "logs",
      "gates_file": "gates.json",
      "perspectives_file": "perspectives.json",
      "citations_file": "citations/citations.jsonl",
      "summary_pack_file": "summaries/summary-pack.json",
      "pivot_file": "pivot.json"
    }
  },
  "metrics": {},
  "failures": []
}
```

## Evidence (P00-A01)
This document contains:
- field table,
- invariants,
- allowed stages list,
- a concrete JSON example.
