# SkillSecurityVetting

Operational guide for the `skill-security-vetting` skill in `.opencode/skills/skill-security-vetting`.

Roadmap and phase status:

- [SkillSecurityVettingRoadmap](./SkillSecurityVettingRoadmap.md)
- [SkillSecurityVettingPhase3Eval](./SkillSecurityVettingPhase3Eval.md)

## Purpose

Run security scans against local skills using the `skill-scanner` fork with the PAI advisory profile.

## Source locations

- Skill scanner fork: `/Users/zuul/Projects/skill-scanner`
- PAI skill: `/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting`

## Primary command

### Scan all skills

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "$HOME/.config/opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode all \
  --skills-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills"
```

### Scan one skill

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "$HOME/.config/opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode single \
  --skill-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting"
```

### Adjudicate findings (Phase 2)

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "$HOME/.config/opencode/skills/skill-security-vetting/Tools/AdjudicateFindingsWithOpencode.py" \
  --scan-report "/path/to/report.json" \
  --model "openai/gpt-5.2"
```

### Generate human-readable audit report

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "$HOME/.config/opencode/skills/skill-security-vetting/Tools/GenerateSecurityAuditReport.py" \
  --raw-report "/path/to/raw/report.json" \
  --allowlisted-report "/path/to/allowlisted/report.json" \
  --allowlist-summary "/path/to/allowlisted/allowlist-summary.json" \
  --suppressed-findings "/path/to/allowlisted/suppressed-findings.json" \
  --adjudication "/path/to/triage/adjudication.json" \
  --output-file "/path/to/security-audit-report.md"
```

## Artifacts

Each run writes:

- `summary.txt`
- `report.json`
- `report.sarif`

Default output path:

`/Users/zuul/Projects/skill-scanner/reports/pai-scan/<timestamp>-<mode>/`

Override with `--output-dir <dir>`.

## Advisory-first behavior

- Uses static + behavioral + trigger analyzers.
- Uses advisory rule suppression for `MANIFEST_MISSING_LICENSE`.
- Does **not** fail by default on findings.
- Add `--fail-on-findings` only when gate enforcement is enabled.

## Allowlist policy (separate file, not opencode.json)

Scanner allowlisting is controlled by dedicated files (to avoid `opencode.json` schema coupling):

- Repo baseline (tracked):
  - `/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Data/allowlist.json`
- Optional runtime override (local/private):
  - `~/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/skill-security-vetting/allowlist.json`

CLI options:

- `--no-allowlist` — disable filtering and see raw findings
- `--allowlist-file <path>` — add one or more extra policy files
- `--fail-on-expired-allowlist` — fail when expired allowlist entries are present

Gate profile options:

- `--gate-profile advisory` (default)
- `--gate-profile block-critical`
- `--gate-profile block-high`

Blocking profiles enforce expired-allowlist failures automatically.

Optional semantic analyzer in wrapper:

- `--use-opencode-analyzer`
- `--opencode-model`
- `--opencode-timeout`
- `--opencode-agent`
- `--opencode-debug-dir`

Progress visibility options:

- default: per-skill progress + heartbeat logs are enabled
- `--no-progress` disable progress output
- `--progress-interval <seconds>` set heartbeat cadence (default: 15)
- when opencode analyzer is enabled, wrapper prints worst-case runtime estimate
- Ctrl-C exits cleanly (code 130) and keeps partial artifacts when possible

## Install-time gate integration

`Tools/Install.ts` now runs a pre-install skills security gate against source skills by default:

- default profile: `advisory`
- default scope: changed skills only (source vs target diff)
- configurable via:
  - `--skills-gate-profile off|advisory|block-critical|block-high`
  - `--skills-gate-scanner-root <dir>`
  - `--skills-gate-scan-all` (override changed-skill scope)

Example enforced install:

```bash
bun Tools/Install.ts --target ~/.config/opencode --skills-gate-profile block-critical
```

Additional artifacts per run:

- `suppressed-findings.json`
- `allowlist-summary.json`

Additional scan mode:

- `--mode list --skill-list-file <path>` for targeted changed-skill scans.

Additional Phase 2 adjudication artifacts:

- `adjudication.json`
- `prioritized-actions.md`
- `llm-text-output.txt`
- `opencode-events.jsonl`

Additional audit artifact:

- `security-audit-report.md` (human-readable stakeholder report)

## Policy reminder: fix before mute

If findings are real and actionable, fix underlying code/instructions first.  
Tune/disable rules only for non-exploitable cases with documented rationale.
