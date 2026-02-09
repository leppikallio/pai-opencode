# Skill Security Vetting Roadmap

This document tracks the implementation roadmap and progress for PAI skill security vetting using the `skill-scanner` fork.

## Scope

- Scanner fork: `/Users/zuul/Projects/skill-scanner`
- PAI repo integration: `/Users/zuul/Projects/pai-opencode`
- Primary runtime skill: `.opencode/skills/skill-security-vetting`

## Current status

- **Phase 1**: ✅ Complete
- **Phase 2**: ✅ Complete
- **Phase 3**: 🚧 In progress (P3.1–P3.3 implemented, P3.4 eval comparison pending)

---

## Phase 1 — Deterministic Gate (Advisory-first)

### Completed

- [x] Parser hardening for generated `SKILL.md` preambles (comment before frontmatter)
- [x] Regression tests for parser behavior
- [x] PAI scan profile documentation + helper script in scanner fork
- [x] PAI security-vetting skill and workflows in `pai-opencode`
- [x] Python-native wrapper (`RunSecurityScan.py`) for all/single skill scans
- [x] Allowlist system with separate policy files (not `opencode.json`)
- [x] Suppression audit artifacts (`suppressed-findings.json`, `allowlist-summary.json`)
- [x] Root-level allowlist lifecycle tooling in `create-skill`
- [x] Policy checks in scanner for:
  - `SkillSearch(` legacy pattern
  - unsupported `context:` frontmatter field
- [x] Formal gate profiles:
  - `advisory`
  - `block-critical`
  - `block-high`
- [x] Install-time preflight enforcement hook in `Tools/Install.ts`

### Gate behavior model (implemented)

- `advisory`: never blocks
- `block-critical`: blocks on unsuppressed CRITICAL findings
- `block-high`: blocks on unsuppressed HIGH or CRITICAL findings
- Blocking profiles enforce expired-allowlist failure automatically

### Install integration (implemented)

`Tools/Install.ts` supports:

- `--skills-gate-profile off|advisory|block-critical|block-high`
- `--skills-gate-scanner-root <dir>`

The gate runs against **source skills before runtime copy**.

---

## Phase 2 — Local Subagent Adjudication Layer

### P2.1 Triage schema contract

- [x] Define structured adjudication schema:
  - `finding_id`
  - `verdict` (`true_positive | likely_false_positive | needs_review`)
  - `confidence`
  - `exploitability`
  - `impact`
  - `remediation`
  - `rationale`

Implemented via:

- `.opencode/skills/skill-security-vetting/Tools/AdjudicateFindingsWithOpencode.py`

### P2.2 Pipeline

- [x] Implement `scan -> triage -> prioritized action list`
- [x] Keep raw and adjudicated outputs side-by-side
- [x] Preserve deterministic references (`file`, `line`, `rule_id`)

Artifacts:

- `adjudication.json`
- `prioritized-actions.md`
- `llm-text-output.txt`
- `opencode-events.jsonl`

### P2.2.1 Audit artifact generator (implemented)

- [x] Added `Tools/GenerateSecurityAuditReport.py`
- [x] Generates stakeholder-facing markdown report combining:
  - deterministic raw scan stats
  - allowlisted operational stats
  - key findings with brief explanation
  - adjudication summary + actionable recommendations

### P2.3 Report UX

- [x] Executive summary
- [x] Prioritized remediation queue
- [x] Likely false positives section with rationale
- [x] Patch-oriented recommendation candidates included in adjudication-derived action section

---

## Phase 3 — Native Opencode Analyzer in fork

### P3.1 Analyzer implementation

- [x] Add `opencode_analyzer.py`
- [x] Implement analyzer contract (`BaseAnalyzer.analyze -> list[Finding]`)
- [x] Map output to existing severity/taxonomy models

### P3.2 CLI/API integration

- [x] Add `--use-opencode` style flags
- [x] Expose analyzer in API path
- [x] Update scanner docs

### P3.3 Security hardening

- [x] Strict response schema validation
- [x] Fail-safe timeout/malformed-output handling
- [x] Treat scanned content as untrusted input end-to-end

### P3.4 Validation

- [x] Unit tests
- [x] Integration tests with mocked opencode responses
- [~] Eval comparison across baseline / phase2 / phase3 modes (initial pass + targeted tuning runs complete; full-repo budgeted pass pending)

Reference:

- [SkillSecurityVettingPhase3Eval](./SkillSecurityVettingPhase3Eval.md)

---

## Operating principles

1. **Fix before mute**
   - Fix real issues first.
   - Suppress only non-exploitable contextual findings.

2. **Explicit risk ownership**
   - Each suppression must include `owner`, `reason`, and `expires_at`.

3. **Dual visibility**
   - Keep both raw (`--no-allowlist`) and allowlisted views available.

4. **No core config coupling**
   - Keep scanner policy outside `opencode.json`.

---

## Quick operational commands

```bash
# All skills (advisory)
cd "/Users/zuul/Projects/skill-scanner"
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode all \
  --skills-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills"

# Raw baseline (no allowlist)
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode all \
  --skills-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills" \
  --no-allowlist

# Enforced install gate example
cd "/Users/zuul/Projects/pai-opencode"
bun Tools/Install.ts --target ~/.config/opencode --skills-gate-profile block-critical
```
