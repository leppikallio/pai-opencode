# ManageScannerAllowlist Workflow

Purpose: Maintain skill-scanner allowlist entries from create-skill as a root-level lifecycle concern.

## Policy

- Fix before mute: if issue is actionable, fix code/instructions first.
- Allowlist only for non-exploitable-in-context findings.
- Every suppression needs owner + reason + expiry.

## Inputs

- Skill name
- Scanner finding(s): `rule_id`, analyzer, optional file/title context
- Decision: fix or suppress

## Steps

1. Run scan (prefer raw mode first):

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode all \
  --skills-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills" \
  --no-allowlist
```

2. Triage finding(s):
   - `fixed`
   - `deferred-fix`
   - `tuned-rule`

3. For `tuned-rule`, upsert suppression entry:

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/create-skill/Tools/ManageSkillScannerAllowlist.py" upsert \
  --id "<stable-id>" \
  --skill "<skill-name>" \
  --rule-id "<RULE_ID>" \
  --reason "<context + why non-exploitable>" \
  --owner "<owner>" \
  --expires-at "YYYY-MM-DD"
```

4. Re-run allowlisted scan:

```bash
cd "/Users/zuul/Projects/skill-scanner"
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Tools/RunSecurityScan.py" \
  --mode all \
  --skills-dir "/Users/zuul/Projects/pai-opencode/.opencode/skills"
```

5. Verify artifacts include suppression traceability:
   - `suppressed-findings.json`
   - `allowlist-summary.json`

## Output

- Updated allowlist policy (`Data/allowlist.json` by default)
- Clear evidence of what was suppressed and why
