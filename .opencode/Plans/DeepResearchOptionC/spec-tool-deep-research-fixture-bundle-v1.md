# spec-tool-deep-research-fixture-bundle-v1 (P06-03)

## Purpose
Define the **offline fixture bundle format** used by Phase 06 replay/harness tooling.

This bundle is a **portable, deterministic snapshot** of the minimum artifacts required to:
- re-compute Gate E (Synthesis Quality) metrics **offline**,
- reproduce `pass|fail` + `warnings[]` deterministically,
- support a replay harness that never needs the network.

Non-goals:
- This spec does **not** define the replay tool itself.
- This spec does **not** change Gate E metrics or thresholds.

## Bundle root
The **bundle root** is a directory containing the files listed below at **canonical relative paths**.

Packaging:
- The bundle MAY be stored as a plain directory (preferred in repo fixtures).
- The bundle MAY be shipped as an archive (zip/tar). If archived, the archive MUST unpack to exactly one top-level directory that is the bundle root.

## Versioning (bundle format)
The bundle format version tag is carried by a required metadata file:

- `bundle.json` (at bundle root)
  - `schema_version` MUST be exactly: `fixture_bundle.v1`

Notes:
- This is the **bundle** schema/version tag.
- The run-level artifacts inside the bundle keep their own schema versions (e.g., `manifest.v1`, `gates.v1`, `citation.v1`).

### `bundle.json` (required) — minimal schema
Required fields:
- `schema_version`: `"fixture_bundle.v1"`
- `bundle_id`: stable identifier for this fixture bundle (string)
- `run_id`: must match `manifest.json.run_id` and `gates.json.run_id` (string)
- `created_at`: ISO timestamp (string)
- `no_web`: MUST be `true`
- `included_paths`: array of bundle-relative paths included in this bundle
  - MUST be sorted lexicographically (byte-order)

Optional but recommended fields:
- `inputs_digest`: copy of `gates.json.inputs_digest` (string)
- `sha256`: map of `path -> sha256:<hex>` digests for each included file
  - keys MUST be sorted lexicographically

## Required files (canonical relative paths)

### Required — minimum viable Gate E offline replay
These files MUST exist for a bundle to be considered valid `fixture_bundle.v1`.

| Path (relative to bundle root) | Required | Description |
|---|:---:|---|
| `bundle.json` | ✅ | Bundle metadata + format version tag (`fixture_bundle.v1`) |
| `manifest.json` | ✅ | Run manifest (`manifest.v1`) used as replay anchor |
| `gates.json` | ✅ | Gate state snapshot (`gates.v1`) including Gate E status + warnings |
| `citations/citations.jsonl` | ✅ | Validated citation pool (`citation.v1` records), sorted by `normalized_url` |
| `synthesis/final-synthesis.md` | ✅ | Final synthesis markdown used as Gate E input |

### Required — Phase 06 Gate E evidence artifacts
Phase 06 deliverables require Gate E to be mechanically computable and regression-testable **from offline artifacts**.

Therefore a Phase 06 fixture bundle MUST also include deterministic Gate E evidence outputs:

| Path (relative to bundle root) | Required | Description |
|---|:---:|---|
| `reports/gate-e-numeric-claims.json` | ✅ | Deterministic numeric-claim check output (must prove `uncited_numeric_claims = 0` for pass fixtures) |
| `reports/gate-e-citation-utilization.json` | ✅ | Deterministic utilization report (must include `citation_utilization_rate` and `duplicate_citation_rate`) |
| `reports/gate-e-sections-present.json` | ✅ | Deterministic required-sections presence report (must align to Gate E required headings) |
| `reports/gate-e-status.json` | ✅ | Deterministic summary of Gate E `pass|fail` and `warnings[]` (may be derived from `gates.json`) |

Notes:
- The exact JSON schemas for `reports/gate-e-*.json` are defined elsewhere.
- This bundle spec only fixes **canonical paths** and determinism expectations.

### Optional (recommended)
These artifacts are not required for Gate E replay, but improve debugging, observability, and future harness scope.

| Path (relative to bundle root) | Required | Description |
|---|:---:|---|
| `logs/audit.jsonl` | ❌ | Deterministic audit log append-only stream (if present, must be JSONL with stable ordering) |
| `summaries/summary-pack.json` | ❌ | Summary pack (`summary_pack.v1`) used to produce synthesis drafts |
| `summaries/*.md` | ❌ | Bounded per-perspective summaries used in synthesis |
| `perspectives.json` | ❌ | Perspective definitions (`perspectives.v1`) used to interpret wave outputs |
| `wave-1/*.md` | ❌ | Wave 1 outputs (useful for provenance, not needed to replay Gate E) |
| `wave-2/*.md` | ❌ | Wave 2 outputs (optional) |
| `metrics/run-metrics.json` | ❌ | Run-level metrics summary (Phase 06 telemetry) |

## Normalization rules (all bundles)

### Newline + encoding normalization
All text-based artifacts in the bundle MUST satisfy:
1. UTF-8 encoding.
2. Newlines normalized to **LF** (`\n`).
3. File MUST end with a trailing newline.

Applies to (non-exhaustive):
- `*.md`, `*.json`, `*.jsonl`, `*.txt`.

### Deterministic ordering expectations
To make bundles reproducible and diff-friendly:

1. **`bundle.json.included_paths[]`** MUST be sorted lexicographically.
2. **`citations/citations.jsonl`** MUST be written sorted by `normalized_url` (ascending).
3. If `bundle.json.sha256` is present:
   - keys MUST be sorted lexicographically,
   - each digest MUST be computed on the exact on-disk bytes of the referenced file.
4. JSON formatting SHOULD be stable across runs:
   - recommended: 2-space indentation + trailing newline.
   - any producing tool MUST be byte-stable for identical logical content.

## “No web” guarantee
This bundle format is **offline-first**.

### Guarantee statement (required semantics)
A valid `fixture_bundle.v1` MUST be capturable and replayable under **no-network** conditions:
- capture and replay MUST NOT require web fetches,
- replay tools MUST NOT attempt any network access,
- all data required to evaluate Gate E MUST be present inside the bundle.

### Required attestation
- `bundle.json.no_web` MUST be `true`.

Operational note:
- Offline replay is expected to run with environment `PAI_DR_NO_WEB=1`.

## Minimal example bundle layout (tree)
```text
<fixture-bundle-root>/
  bundle.json
  manifest.json
  gates.json
  citations/
    citations.jsonl
  synthesis/
    final-synthesis.md
  reports/
    gate-e-numeric-claims.json
    gate-e-citation-utilization.json
    gate-e-sections-present.json
    gate-e-status.json
```
