# spec-tool-deep-research-review-factory-run-v1 (P05-09)

## Tool name
`deep_research_review_factory_run`

## Purpose
Run a bounded set of reviewers against a synthesis draft and emit a deterministic review bundle under `review/`.

This tool must support a fixture mode for entity tests.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute |
| `draft_path` | string | ❌ | absolute; default: `<runRoot>/synthesis/draft-synthesis.md` |
| `citations_path` | string | ❌ | absolute; default: `<runRoot>/citations/citations.jsonl` |
| `mode` | string | ❌ | `fixture|generate`; default `fixture` for tests |
| `fixture_bundle_dir` | string | ❌ | required for `mode=fixture`; absolute directory with reviewer outputs |
| `review_dir` | string | ❌ | absolute; default: `<runRoot>/review/` |
| `reason` | string | ✅ | audit |

## Outputs
| Field | Type | Required |
|---|---:|:---:|
| `ok` | boolean | ✅ |
| `review_bundle_path` | string | ✅ |
| `decision` | string | ✅ | `PASS|CHANGES_REQUIRED` |
| `inputs_digest` | string | ✅ |

## Review bundle artifact (v1)
Written to `<runRoot>/review/review-bundle.json`:
```json
{
  "schema_version": "review_bundle.v1",
  "run_id": "dr_...",
  "decision": "CHANGES_REQUIRED",
  "findings": [],
  "directives": []
}
```

## Determinism rules
- Fixture mode is deterministic.
- Bundle MUST be bounded (cap findings/directives to 100 each).

## References
- `spec-reviewer-rubrics-v1.md`
