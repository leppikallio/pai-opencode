---
name: skill-security-vetting
description: Security vetting for local agent skills using the skill-scanner fork. USE WHEN scanning one skill, scanning all skills, producing SARIF/JSON reports, triaging findings, or preparing to enforce security gates.
---

# Skill Security Vetting

## Purpose

Use this skill to run consistent security scans against local skill packages and generate evidence artifacts.

This skill is designed for the Phase 1 advisory rollout:

- deterministic static + behavioral + trigger scanning
- report generation (summary, JSON, SARIF)
- non-blocking by default while false positives are tuned

## Scanner Source of Truth

Fork location:

`/Users/zuul/Projects/skill-scanner`

PAI profile docs:

`/Users/zuul/Projects/skill-scanner/docs/pai-profile.md`

Helper script:

`/Users/zuul/Projects/skill-scanner/scripts/scan-pai-skills.sh`

## Available Workflows

### 1) ScanSingleSkill.md

Use when vetting one specific skill directory during development.

### 2) ScanAllSkills.md

Use when producing a full baseline or periodic audit across all skills.

### 3) TriageFindings.md

Use when converting raw findings into prioritized remediation actions.

### 4) GenerateAuditReport.md

Use when producing a stakeholder-ready audit artifact that combines deterministic scans and adjudication output.

## Tooling

### `Tools/RunSecurityScan.py`

Wrapper for running the PAI advisory scan profile and producing artifacts.

Examples:

```bash
# Run from scanner uv environment for dependency consistency
cd "/Users/zuul/Projects/skill-scanner"

# Scan one skill
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode single \
  --skill-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting"

# Scan all skills
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode all \
  --skills-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills"
```

Allowlist support:

- Default repo policy: `Data/allowlist.json`
- Optional runtime override: `~/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/skill-security-vetting/allowlist.json`
- Disable filtering for raw baseline: `--no-allowlist`

Gate profiles:

- `--gate-profile advisory` (default; never blocks)
- `--gate-profile block-critical` (fails on unsuppressed CRITICAL)
- `--gate-profile block-high` (fails on unsuppressed HIGH/CRITICAL)

In blocking profiles, expired allowlist rules fail the run.

Optional semantic layer:

- Enable native scanner opencode analyzer with `--use-opencode-analyzer`
- Tuning knobs:
  - `--opencode-model`
  - `--opencode-timeout`
  - `--opencode-agent`
  - `--opencode-debug-dir`

Progress/heartbeat controls:

- default: progress output enabled
- disable: `--no-progress`
- set heartbeat interval: `--progress-interval <seconds>`

### `Tools/AdjudicateFindingsWithOpencode.py`

Phase 2 LLM adjudication tool using `opencode run`.

Converts scanner `report.json` into structured triage with:

- verdict (`true_positive|likely_false_positive|needs_review`)
- exploitability + impact
- action (`fix_now|deferred_fix|tuned_rule|needs_human_review`)
- rationale + remediation

Artifacts:

- `adjudication.json`
- `prioritized-actions.md`
- raw LLM output traces (`opencode-events.jsonl`, `llm-text-output.txt`)

### `Tools/GenerateSecurityAuditReport.py`

Builds a clear markdown audit report from scan/adjudication artifacts.

Output includes:

- statistics (raw + allowlisted)
- top findings with brief explanations
- actionable recommendations and remediation candidates

## Advisory-First Rule

By default, run scans without blocking builds/commits until agreed promotion criteria are met.

Promotion path:

1. Block CRITICAL findings
2. Then block HIGH + CRITICAL findings
