# Phase 04 Executable Backlog — Citation and Evidence Services (Gate C)

## Objective
Create canonical, deterministic citation infrastructure that:
- extracts and normalizes source URLs from wave artifacts,
- produces a validated `citations.jsonl` pool (per schema),
- computes **Gate C** metrics deterministically and blocks downstream stages if Gate C fails,
- supports **OFFLINE** (fixture-driven) validation for tests/dry-runs, with **optional ONLINE** validation behind feature flags.

## Dependencies
- Phase 03 complete and Wave artifacts exist + are contract-validated (Gate B):
  - `deep-research-option-c-phase-03-executable-backlog.md`
- Citation record schema and normalization/cid rules are authoritative:
  - `spec-citation-schema-v1.md` (do not re-invent; tools must implement/reference this)
- Gate thresholds and formulas are authoritative:
  - `spec-gate-thresholds-v1.md` (Gate C section)
- Gate C reviewer rubric is authoritative:
  - `spec-reviewer-rubrics-v1.md` (Gate C rubric)
- Stage machine gating is authoritative (citations → summaries requires Gate C pass):
  - `spec-stage-machine-v1.md`
- Cross-phase testing requirement (seconds-fast entity contract tests + fixtures):
  - `deep-research-option-c-testing-strategy-v1.md`
- Feature-flag surface for OFFLINE vs ONLINE behavior:
  - `spec-feature-flags-v1.md` (notably `PAI_DR_NO_WEB`, `PAI_DR_CITATION_VALIDATION_TIER`)

## Gate

- **Gate C:** citation validation integrity (HARD)

**Required artifacts (per run):**
- `~/.config/opencode/research-runs/<run_id>/citations/citations.jsonl`
- `~/.config/opencode/research-runs/<run_id>/citations/extracted-urls.txt` (or equivalent extracted list)

**Metrics and thresholds (must match `spec-gate-thresholds-v1.md` exactly):**
| Metric | Threshold |
|---|---:|
| `validated_url_rate` | >= 0.90 |
| `invalid_url_rate` | <= 0.10 |
| `uncategorized_url_rate` | 0.00 |

**Metric formulas (deterministic):**
Let `U` = the set of extracted URLs after normalization/deduplication (one entry per `normalized_url`).
Let each `u ∈ U` have exactly one status in `citations/citations.jsonl`.

Allowed statuses (v1):
- `valid|paywalled|invalid|blocked|mismatch`

- `validated_url_rate` = `count(u where status IN {"valid","paywalled"}) / count(U)`
- `invalid_url_rate` = `count(u where status IN {"invalid","blocked","mismatch"}) / count(U)`
- `uncategorized_url_rate` = `count(u where status NOT IN {"valid","paywalled","invalid","blocked","mismatch"}) / count(U)`

Rules:
- The gate MUST FAIL if any extracted URL has missing status (treated as uncategorized).
- `count(U)` MUST be > 0; otherwise the gate fails with reason `NO_URLS_EXTRACTED`.
- Synthesis must block if Gate C fails (see `spec-stage-machine-v1.md`).

**OFFLINE vs ONLINE policy (must be explicit in implementation):**
- OFFLINE deterministic mode (tests + fixtures + dry-run):
  - Activated by `PAI_DR_NO_WEB=1` (per `spec-feature-flags-v1.md`).
  - URL “validation” must be fixture-driven and deterministic; no network calls.
- ONLINE validation mode (optional runtime behavior):
  - Activated only when `PAI_DR_NO_WEB=0`.
  - Thoroughness may vary by `PAI_DR_CITATION_VALIDATION_TIER=basic|standard|thorough`.
  - ONLINE mode must never be required for unit/entity tests; tests must remain seconds-fast.

## Backlog (Owner/Reviewer mapped)

| ID | Task | Owner | Reviewer | Dependencies | Deliverable | Evidence |
|---|---|---|---|---|---|---|
| P04-01 | Define deterministic **citation URL extraction** contract (inputs: Wave artifacts; output: extracted URL list + provenance pointers; stable ordering; no web/agents) | Architect | Engineer | Phase 03 artifacts + `deep-research-option-c-phase-04-citation-system.md` | `spec-tool-deep-research-citations-extract-urls-v1.md` | manual-check: spec exists; references `spec-citation-schema-v1.md`; includes examples and determinism rules |
| P04-02 | Implement tool: `deep_research_citations_extract_urls` (writes `~/.config/opencode/research-runs/<run_id>/citations/extracted-urls.txt` and `citations/found-by.json` or equivalent provenance artifact) | Engineer | Architect | P04-01 | Tool implementation + wiring | `bun test .opencode/tests/entities/deep_research_citations_extract_urls.test.ts` passes |
| P04-T1 | Add entity tests + fixtures for `deep_research_citations_extract_urls` (Wave 1-only; Wave 1+2; empty sources; malformed sources) | Engineer | QATester | P04-02 + testing strategy | `.opencode/tests/entities/deep_research_citations_extract_urls.test.ts` + fixtures under `.opencode/tests/fixtures/runs/...` | `bun test .opencode/tests/entities/deep_research_citations_extract_urls.test.ts` passes in seconds |
| P04-03 | Define **normalization + cid computation tool** contract that explicitly **references** `spec-citation-schema-v1.md` (no new rules) | Architect | Engineer | `spec-citation-schema-v1.md` + P04-01 | `spec-tool-deep-research-citations-normalize-v1.md` | manual-check: spec links to `spec-citation-schema-v1.md` normalization + cid rules; includes ≥2 concrete examples |
| P04-04 | Implement tool: `deep_research_citations_normalize` (reads extracted URLs, applies normalization + cid rules per `spec-citation-schema-v1.md`, writes `citations/normalized-urls.txt` + deterministic mapping artifact) | Engineer | Architect | P04-03 | Tool implementation + artifacts: `~/.config/opencode/research-runs/<run_id>/citations/normalized-urls.txt` (and mapping JSON as needed) | `bun test .opencode/tests/entities/deep_research_citations_normalize.test.ts` passes |
| P04-T2 | Add entity tests + fixtures for `deep_research_citations_normalize` (utm stripping; fragment removal; query sorting; default ports; trailing slash rules; cid length/hex/lowercase) | Engineer | QATester | P04-04 + testing strategy | `.opencode/tests/entities/deep_research_citations_normalize.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_citations_normalize.test.ts` passes in seconds |
| P04-05 | Define **citation validation** contract with explicit OFFLINE vs ONLINE modes behind flags (`PAI_DR_NO_WEB`, `PAI_DR_CITATION_VALIDATION_TIER`) and outputs conforming to `spec-citation-schema-v1.md`. ONLINE validation MUST enforce an SSRF-safe URL policy: allow only `http/https`; deny `file/data/javascript/gopher/...`; deny userinfo; deny localhost + private IP ranges (IPv4+IPv6, incl. 127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10); validate every redirect hop; cap redirects; enforce tight timeouts + max response size; redact secrets in stored artifacts and logs. | Architect | Engineer | `spec-feature-flags-v1.md` + `spec-citation-schema-v1.md` | `spec-tool-deep-research-citations-validate-v1.md` | manual-check: spec documents OFFLINE fixture mode + ONLINE optional mode; references schema fields; includes error codes and SSRF-safe policy |
| P04-SEC1 | Define **SSRF-safe URL policy** for ONLINE citation validation (schemes, IP ranges, DNS resolution rules, redirect hop validation, timeout/size limits, userinfo + token redaction rules) | Architect | Engineer | P04-05 + `spec-citation-schema-v1.md` | `spec-url-safety-policy-v1.md` (or section inside `spec-tool-deep-research-citations-validate-v1.md`) | manual-check: policy explicitly covers localhost, private IPs, file://, redirects, credentials |
| P04-06 | Implement tool: `deep_research_citations_validate` (OFFLINE: fixture-driven; ONLINE: optional fetch/redirect resolution; writes `citations/citations.jsonl` at `~/.config/opencode/research-runs/<run_id>/citations/citations.jsonl`). Implementation must apply the SSRF-safe URL policy in ONLINE mode and MUST NOT log/store raw credential-bearing URLs. | Engineer | Architect | P04-05 + P04-04 | Tool implementation + artifacts | `bun test .opencode/tests/entities/deep_research_citations_validate.test.ts` passes (OFFLINE fixtures; `PAI_DR_NO_WEB=1`) |
| P04-T3 | Add entity tests + fixtures for `deep_research_citations_validate` in OFFLINE mode (valid/invalid; missing fixture entry deterministic behavior; stable ordering; required fields present) | Engineer | QATester | P04-06 + testing strategy | `.opencode/tests/entities/deep_research_citations_validate.test.ts` + fixtures incl. `fixtures/url-checks.json` | `bun test .opencode/tests/entities/deep_research_citations_validate.test.ts` passes in seconds |
| P04-TSEC1 | Add OFFLINE tests for URL abuse classification + redaction (userinfo URLs, localhost, private IP literals, `example.com@127.0.0.1`, IPv6 loopback, token-like query keys) | Engineer | QATester | P04-06 | `.opencode/tests/entities/deep_research_citations_validate.security.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_citations_validate.security.test.ts` passes; snapshots confirm redaction (no raw secrets) |
| P04-07 | Define deterministic **Gate C metric calculator** contract (reads extracted+normalized set `U` and `citations.jsonl`; computes formulas exactly as `spec-gate-thresholds-v1.md`) | Architect | Engineer | `spec-gate-thresholds-v1.md` + `spec-reviewer-rubrics-v1.md` | `spec-tool-deep-research-gate-c-compute-v1.md` | manual-check: spec quotes Gate C formulas/thresholds verbatim; includes pass/fail examples (incl. NO_URLS_EXTRACTED) |
| P04-08 | Implement tool: `deep_research_gate_c_compute` (writes/updates `~/.config/opencode/research-runs/<run_id>/gates.json` excerpt for Gate C; emits warnings/errors deterministically) | Engineer | Architect | P04-07 + P04-06 | Tool implementation + Gate C report fields in gates artifact | `bun test .opencode/tests/entities/deep_research_gate_c_compute.test.ts` passes |
| P04-T4 | Add entity tests + fixtures for `deep_research_gate_c_compute` (PASS at 0.90/0.10/0.00 boundary; FAIL uncategorized>0; FAIL U=0 → NO_URLS_EXTRACTED) | Engineer | QATester | P04-08 + testing strategy | `.opencode/tests/entities/deep_research_gate_c_compute.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_gate_c_compute.test.ts` passes in seconds |
| P04-09 | Implement deterministic renderer: `deep_research_citations_render_md` (writes `~/.config/opencode/research-runs/<run_id>/citations/validated-citations.md` from `citations.jsonl`; stable ordering by `normalized_url` or `cid`) | Engineer | Architect | `spec-citation-schema-v1.md` + P04-06 | Tool implementation + artifact `citations/validated-citations.md` | `bun test .opencode/tests/entities/deep_research_citations_render_md.test.ts` passes |
| P04-T5 | Add entity tests + fixtures for `deep_research_citations_render_md` (snapshot-style content checks: includes `cid`, `url`, title/publisher when present; deterministic ordering) | Engineer | QATester | P04-09 + testing strategy | `.opencode/tests/entities/deep_research_citations_render_md.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_citations_render_md.test.ts` passes in seconds |
| P04-10 | Wire the **citations stage executor** into the stage machine (citations stage runs: extract → normalize → validate → gate compute → render; blocks `summaries` unless Gate C pass) | Engineer | Architect | `spec-stage-machine-v1.md` + Phase 02/03 orchestrator wiring | Implementation update to orchestrator stage runner (e.g., `deep_research_stage_run_citations` or equivalent) | `bun test .opencode/tests/fixtures/...` (fixture-run) passes; manual-check: stage transition halts when Gate C fails |
| P04-T6 | Add fixture replay test for citations stage (given frozen Wave artifacts fixture, run one “tick”/stage step and assert produced citations artifacts + Gate C status deterministically) | Engineer | QATester | P04-10 + testing strategy | `.opencode/tests/entities/deep_research_stage_citations.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_stage_citations.test.ts` passes in seconds |
| P04-ON1 | Add **optional ONLINE validation smoke** (skipped by default; runs only when `PAI_DR_NO_WEB=0`; validates that tool can fetch and populate fields without breaking schema). ONLINE smoke must run only in sandboxed environment (no access to internal networks); document prerequisites. | Engineer | QATester | P04-06 | Optional test file guarded by env checks + documented in spec | manual-check: running `PAI_DR_NO_WEB=0 bun test ...` performs live checks in sandbox; default CI remains OFFLINE |
| P04-X1 | Phase 04 checkpoint + **Gate C signoff** | Architect | QATester | all P04-* | `PHASE-04-CHECKPOINT-GATE-C.md` | manual-check: reviewer PASS per `spec-reviewer-rubrics-v1.md` Gate C checklist; includes `gates.json` excerpt and sample `citations.jsonl` (≥5 lines) |

## Notes
- Keep OFFLINE tests fixture-driven and seconds-fast.
- Treat URL normalization (`spec-citation-schema-v1.md`) and URL safety (SSRF policy) as separate contracts.
