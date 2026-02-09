---
name: osint
description: "Open source intelligence gathering. USE WHEN OSINT, due diligence, background check, research person, company intel, investigate. Use `skill_find` with query `osint` for docs."
---

## Customization

**Before executing, check for user customizations at:**
`~/.config/opencode/skills/CORE/USER/SKILLCUSTOMIZATIONS/osint/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

# OSINT Skill

Open Source Intelligence gathering for authorized investigations.

---

## Voice Notification

**When executing a workflow, do BOTH:**

1. **Send voice notification**:
   Use the `voice_notify` tool:

- `message`: "Running the WORKFLOWNAME workflow from the OSINT skill"
~/.config/opencode/MEMORY/WORK/$(jq -r '.work_dir' ~/.config/opencode/MEMORY/STATE/current-work.json)/scratch/YYYY-MM-DD-HHMMSS_osint-[target]/
```

**Archived reports:**
```
~/.config/opencode/History/research/YYYY-MM/[target]-osint/
```

---

## Ethical Guardrails

**ALLOWED:** Public sources only - websites, social media, public records, search engines, archived content

**PROHIBITED:** Private data, unauthorized access, social engineering, purchasing breached data, ToS violations

See `EthicalFramework.md` for complete requirements.

---

**Version:** 2.0 (Canonical Structure)
**Last Updated:** December 2024
