# spec-pivot-decision-schema-v1 (P03-07)

## Purpose
Define the canonical **pivot decision artifact** written during stage `pivot`.

This artifact is the deterministic output of `deep_research_pivot_decide` and is used by:
- the stage machine to decide whether to execute `wave2` or skip it, and
- downstream tooling to understand why Wave 2 ran or did not.

---

## File
- Canonical path (per `spec-manifest-schema-v1.md`, default): `~/.config/opencode/research-runs/<run_id>/pivot.json`
- Format: JSON

---

## Schema: `pivot_decision.v1`

### Top-level fields
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `schema_version` | string | ✅ | fixed: `pivot_decision.v1` |
| `run_id` | string | ✅ | must match manifest run_id |
| `generated_at` | string | ✅ | ISO timestamp |
| `inputs_digest` | string | ✅ | `sha256:<hex>` over canonicalized decision inputs |
| `wave1` | object | ✅ | wave1 evidence bundle |
| `gaps` | array | ✅ | normalized gap list (may be empty) |
| `decision` | object | ✅ | pivot outcome and explanation |

### `wave1` object
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `outputs` | array | ✅ | one per `perspective_id`, sorted |

Each `wave1.outputs[]` entry:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `perspective_id` | string | ✅ | |
| `output_md` | string | ✅ | run-root-relative path recommended (e.g. `wave-1/p1.md`) |
| `validator_report` | object | ✅ | exact output of `deep_research_wave_output_validate` success shape |

### `gaps[]` entry
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `gap_id` | string | ✅ | unique within artifact |
| `priority` | string | ✅ | `P0|P1|P2|P3` |
| `text` | string | ✅ | normalized single-line text |
| `tags` | array | ✅ | list of normalized tags; may be empty |
| `from_perspective_id` | string | ❌ | optional attribution |
| `source` | string | ✅ | `explicit|parsed_wave1` |

### `decision` object
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `wave2_required` | boolean | ✅ | stage machine input: if true, execute `wave2` |
| `rule_hit` | string | ✅ | one of rubric rule IDs (see `pivot-rubric-v1.md`) |
| `metrics` | object | ✅ | deterministic counts used in rules |
| `explanation` | string | ✅ | template-generated explanation |
| `wave2_gap_ids` | array | ✅ | subset of `gaps[].gap_id` chosen as Wave 2 focus |

`decision.metrics` fields (all required):
- `p0_count`, `p1_count`, `p2_count`, `p3_count`, `total_gaps`

`wave2_gap_ids` rules (v1):
- If `wave2_required=false` → `wave2_gap_ids=[]`.
- If `wave2_required=true` → include **all** `gap_id`s where `priority ∈ {P0,P1}`.
  - If that set is empty (possible via Volume rule), include the first 3 gaps after sorting.

---

## Determinism rules
1. `wave1.outputs[]` MUST be sorted by `perspective_id`.
2. `gaps[]` MUST be sorted by `(priority asc, gap_id asc)`.
3. `inputs_digest` MUST be computed from:
   - `wave1.outputs[].validator_report` values, and
   - the normalized `gaps[]` list,
   excluding `generated_at`.
4. `explanation` MUST be generated from a fixed template using only `rule_hit` + `metrics`.

---

## Worked example JSON (v1)

```json
{
  "schema_version": "pivot_decision.v1",
  "run_id": "dr_20260214_001",
  "generated_at": "2026-02-14T10:20:00Z",
  "inputs_digest": "sha256:2b3c4d5e6f...",
  "wave1": {
    "outputs": [
      {
        "perspective_id": "p1",
        "output_md": "wave-1/p1.md",
        "validator_report": {
          "ok": true,
          "perspective_id": "p1",
           "markdown_path": "/abs/home/.config/opencode/research-runs/dr_20260214_001/wave-1/p1.md",
          "words": 842,
          "sources": 9,
          "missing_sections": []
        }
      },
      {
        "perspective_id": "p2",
        "output_md": "wave-1/p2.md",
        "validator_report": {
          "ok": true,
          "perspective_id": "p2",
           "markdown_path": "/abs/home/.config/opencode/research-runs/dr_20260214_001/wave-1/p2.md",
          "words": 799,
          "sources": 7,
          "missing_sections": []
        }
      }
    ]
  },
  "gaps": [
    {
      "gap_id": "gap_001",
      "priority": "P0",
      "text": "Missing primary-source confirmation for key claim about X.",
      "tags": ["verification"],
      "from_perspective_id": "p1",
      "source": "explicit"
    },
    {
      "gap_id": "gap_002",
      "priority": "P2",
      "text": "Need a comparative baseline against competitor Y.",
      "tags": ["coverage"],
      "from_perspective_id": "p2",
      "source": "explicit"
    }
  ],
  "decision": {
    "wave2_required": true,
    "rule_hit": "Wave2Required.P0",
    "metrics": { "p0_count": 1, "p1_count": 0, "p2_count": 1, "p3_count": 0, "total_gaps": 2 },
    "explanation": "Wave 2 required because p0_count=1 (rule Wave2Required.P0).",
    "wave2_gap_ids": ["gap_001"]
  }
}
```

---

## References
- `pivot-rubric-v1.md`
- `spec-stage-machine-v1.md`
- `spec-tool-deep-research-wave-output-validate-v1.md`
