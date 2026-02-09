# Workflow: Scan Single Skill

## When to use

- You changed one skill and want targeted vetting
- You want immediate JSON evidence for triage

## Inputs

- `SKILL_DIR` absolute path to skill folder containing `SKILL.md`

## Steps

1. Validate target exists and contains `SKILL.md`.
2. Run `RunSecurityScan.py` in single mode.
3. Collect `summary.txt`, `report.json`, and `report.sarif` artifacts.

## Commands

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode single \
  --skill-dir "<SKILL_DIR>" \
  --output-dir "<ARTIFACT_DIR>"
```

## Optional flags

- `--fail-on-findings` once blocking policy is enabled
- `--no-allowlist` to inspect raw, unsuppressed findings

## Expected output

- max severity
- finding list with file/line/rule_id
- remediation guidance per finding
- artifact directory with:
  - `summary.txt`
  - `report.json`
  - `report.sarif`
