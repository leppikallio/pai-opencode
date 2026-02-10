> Up (runtime): `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/SkillSystem.md`
> Source (repo): `/Users/zuul/Projects/pai-opencode/.opencode/skills/PAI/SYSTEM/SkillSystem.md`
> Scope: How system skills apply personal configuration without embedding personal data.

<!-- SKILLSYSTEM:CUSTOMIZATIONS:v1 -->

# SkillSystem — Customizations

This section defines the **SKILLCUSTOMIZATIONS** pattern: a deterministic way for **system skills** to load **personal preferences** at runtime without making the skill itself non-shareable.

## System skills vs personal skills (critical distinction)

### system skill (shareable)

- **Name/dir:** Canonical skill ID (usually lowercase-hyphen, e.g., `browser`, `research`, `skill-security-vetting`)
- **Rule:** MUST NOT contain personal data (contacts, private endpoints, API keys, company-specific processes).
- **Personalization mechanism:** loads from `/Users/zuul/.config/opencode/skills/PAI/USER/` and (optionally) SKILLCUSTOMIZATIONS.

### Personal skill (never shared)

- **Name/dir:** `_ALLCAPS` (e.g., `_CLICKUP`, `_METRICS`)
- **Rule:** may contain personal configuration and secrets.
- **Customization mechanism:** does **not** need SKILLCUSTOMIZATIONS—personalization is already in the skill.

## Where customizations live

All per-skill customizations live under:

`/Users/zuul/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/{skill-id}/`

- `{skill-id}` MUST match the system skill ID exactly (case-sensitive).
- The directory may not exist; absence means “use skill defaults”.

## The SKILLCUSTOMIZATIONS pattern (concise contract)

When a **system skill** supports customizations, it MUST implement this logic:

1. Compute customization directory:
   - `customDir = /Users/zuul/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/{skill-id}/`
2. If `customDir` does not exist → proceed with defaults.
3. If `customDir` exists:
   - Read `EXTEND.yaml`.
   - If `enabled: false` → proceed with defaults.
   - Else load the declared files (usually `PREFERENCES.md` + skill-specific configs).
   - Apply `merge_strategy`.

### Required files

#### `EXTEND.yaml` (required)

This manifest declares what to load and how to merge it.

```yaml
---
skill: skill-id
extends:
  - PREFERENCES.md
  - OtherConfig.md
merge_strategy: override   # append | override | deep_merge
enabled: true
description: "Optional human note explaining intent"
```

#### `PREFERENCES.md` (recommended)

Default place for simple user preferences (tone, defaults, paths, thresholds).

## Merge strategies

| Strategy | Intended meaning | Use when |
|---|---|---|
| `append` | Add items to an existing list/table; keep defaults. | You want to extend defaults. |
| `override` | Replace the default behavior for the customized parts. | You want user rules to win. |
| `deep_merge` | Recursive merge of object-like config (maps). | You have structured config. |

Rule of thumb: prefer `override` unless you have a reason not to.

## What goes where

| Content | Location | Notes |
|---|---|---|
| Generic skill behavior | `skills/{skill-id}/SKILL.md` | Shareable, no personal data. |
| User defaults/preferences | `.../SKILLCUSTOMIZATIONS/{skill-id}/PREFERENCES.md` | Personal, safe to change frequently. |
| Named configs (skill-specific) | `.../SKILLCUSTOMIZATIONS/{skill-id}/*` | e.g., `VoiceConfig.json`, `BrandVoice.md`. |
| Broad user info reused by many skills | `/Users/zuul/.config/opencode/skills/PAI/USER/*` | e.g., contacts, tech stack preferences. |

## Authoring guidance (keep deterministic)

- Keep customizations small and explicit—preference overlay, not a second skill.
- Prefer data/config files over long prose.
- If a workflow needs to consult customization files, it should do so via explicit `Read` of absolute runtime paths.
