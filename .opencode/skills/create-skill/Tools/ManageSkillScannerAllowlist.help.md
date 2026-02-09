# ManageSkillScannerAllowlist

Root-level helper for maintaining scanner allowlist policies used by `skill-security-vetting`.

## Why this exists

`create-skill` is the lifecycle entrypoint for creating/importing/updating skills.  
Allowlisting must be easy and standardized there, not ad-hoc.

Policy rule: **fix before mute**. Only suppress findings when non-exploitable in context, with owner + expiry.

## Default policy file

`/Users/zuul/Projects/pai-opencode/.opencode/skills/skill-security-vetting/Data/allowlist.json`

Override with `--file <path>`.

## Commands

### List

```bash
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/create-skill/Tools/ManageSkillScannerAllowlist.py" list
```

Filter by skill:

```bash
... list --skill web-assessment
```

Include disabled entries:

```bash
... list --include-disabled
```

### Upsert (add/update)

```bash
uv run python "/Users/zuul/Projects/pai-opencode/.opencode/skills/create-skill/Tools/ManageSkillScannerAllowlist.py" upsert \
  --id "web-assessment-env-with-network" \
  --skill "web-assessment" \
  --rule-id "BEHAVIOR_ENV_VAR_EXFILTRATION" \
  --analyzer "behavioral" \
  --file-path "OsintTools/osint-api-tools.py" \
  --reason "Targeted API key getenv usage for legitimate outbound OSINT calls" \
  --owner "Petteri" \
  --expires-at "2026-05-31"
```

Optional filters:

- `--title-contains`
- `--severity`
- `--disabled`

### Disable

```bash
... disable --id "web-assessment-env-with-network"
```

### Prune expired

```bash
... prune-expired
```

## Required fields for suppressions

- `id`
- `skill`
- `rule_id`
- `reason`
- `owner`
- `expires_at` (YYYY-MM-DD)

## Good hygiene

- Keep suppressions narrow (skill + rule + optional analyzer/file/title).
- Expire entries aggressively.
- Re-check raw scan (`--no-allowlist`) regularly.
