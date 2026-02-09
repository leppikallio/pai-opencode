# Workflow: Generate Audit Report

## When to use

- You need a human-readable security audit artifact for stakeholders.
- You want one report that combines deterministic (Phase 1) and adjudicated (Phase 2) results.

## Inputs

- Raw scan report (`report.json` from `--no-allowlist` run)
- Allowlisted scan report (`report.json` from default run)
- Optional:
  - `allowlist-summary.json`
  - `suppressed-findings.json`
  - `adjudication.json`

## Command

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/GenerateSecurityAuditReport.py" \
  --raw-report "<RAW_REPORT_JSON>" \
  --allowlisted-report "<ALLOWLISTED_REPORT_JSON>" \
  --allowlist-summary "<ALLOWLIST_SUMMARY_JSON>" \
  --suppressed-findings "<SUPPRESSED_FINDINGS_JSON>" \
  --adjudication "<ADJUDICATION_JSON>" \
  --output-file "<AUDIT_REPORT_MD>"
```

## Report contents

- Executive summary
- Deterministic statistics (raw + allowlisted)
- Top rule buckets
- Key findings with brief explanations and remediations
- Adjudication summary and prioritized actions
- Confidence notes and next actions

## Verify

- Report file exists and is readable.
- Numbers are consistent with source artifacts.
- Action items are understandable to non-implementers.
