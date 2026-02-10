# Workflow: Scan All Skills

## When to use

- Baseline security audit
- Pre-release security review
- Recurring hygiene checks

## Default target

`/Users/zuul/Projects/pai-opencode/.opencode/skills`

## Recommended command (PAI profile helper)

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode all \
  --skills-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills" \
  --output-dir "<ARTIFACT_DIR>"
```

## Raw equivalent

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run skill-scanner scan-all \
  "/Users/zuul/Projects/pai-opencode/.opencode/skills" \
  --recursive \
  --use-behavioral \
  --use-trigger \
  --disable-rule MANIFEST_MISSING_LICENSE \
  --format summary
```

## Artifacts

The workflow writes:

- `summary.txt`
- `report.json`
- `report.sarif`
- `suppressed-findings.json`
- `allowlist-summary.json`

to the provided `--output-dir` (or default scanner reports path).

## Raw baseline mode

To inspect unsuppressed findings during tuning:

```bash
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode all \
  --skills-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills" \
  --no-allowlist
```

## Gate profiles

Choose one:

- `advisory` (default)
- `block-critical`
- `block-high`

Example:

```bash
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode all \
  --skills-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills" \
  --gate-profile block-critical
```

## Optional: include native opencode analyzer

```bash
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode all \
  --skills-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills" \
  --use-opencode-analyzer \
  --opencode-model "openai/gpt-5.2" \
  --opencode-timeout 120
```

## Changed-skill scoped mode

You can scan a newline-delimited list of specific skill directories:

```bash
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode list \
  --skill-list-file "<CHANGED_SKILLS_TXT>"
```

This is the mode used by the installer preflight when changed-skill optimization is active.

## Progress visibility

Long scans show per-skill progress by default, including heartbeat lines while a skill is being analyzed.

- disable if needed: `--no-progress`
- tune heartbeat cadence: `--progress-interval 5`
- Ctrl-C behavior: scan exits cleanly with code 130 and preserves partial artifacts when available.
