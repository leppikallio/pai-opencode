# Skill Migration Queue

This document is an execution-oriented queue for revising and (if needed) importing skills.

Authoring (base repo): `/Users/zuul/Projects/pai-opencode/.opencode/skills/`

Runtime install destination: `/Users/zuul/.config/opencode/skills/`

## Priority legend

- P0 = unblock/enable the rest (foundation + biggest context wins)
- P1 = high-impact, frequently used, or high-risk domains
- P2 = opportunistic cleanup / correctness / ergonomics

## Batch rules (how to run this queue)

1) Do not edit runtime directly.
   - Edit under: `/Users/zuul/Projects/pai-opencode/.opencode/skills/...`
   - Then install: `bun Tools/Install.ts --target "/Users/zuul/.config/opencode"`

2) No SkillSearch as a required step.
   - If discovery is needed: `glob` then `Read`.

3) Runtime links must be runtime-absolute for internal docs.
   - Prefer: `/Users/zuul/.config/opencode/skills/...`

4) Use these two CreateSkill docs as your guardrails:
   - Minimal canonicalization policy: `/Users/zuul/.config/opencode/skills/CreateSkill/MinimalCanonicalizationPolicy.md`
   - 30-second rubric: `/Users/zuul/.config/opencode/skills/CreateSkill/SkillQualityRubric.md`

## Execution loop per skill (repeatable)

1) Audit:
   - budget lines: use CountSkillBudgetLines tool (examples excluded)
   - search for `SkillSearch(` in `SKILL.md` and remove “SkillSearch required” language
2) Refactor:
   - Make `SKILL.md` a router (procedural: default ≤80 lines)
   - Move deep content into root docs (`Examples.md`, `ApiReference.md`, `StyleGuide.md`, `Templates.md`)
3) Validate:
   - Use: `/Users/zuul/Projects/pai-opencode/.opencode/skills/CreateSkill/Workflows/ValidateSkill.md`
4) Install:
   - `bun Tools/Install.ts --target "/Users/zuul/.config/opencode"`
5) Spot-check:
   - `glob` installed paths then `Read` key files

## Prioritized queue

| Skill | Category | Reason | Next Action |
|---|---|---|---|
| **PAI** | P0 / Foundation / Docs-heavy | Very large and often in the auto-loaded orbit; reducing its always-loaded footprint yields major drift/token wins. | Convert `/Users/zuul/.config/opencode/skills/PAI/SKILL.md` to a router-style doc + move detail into `/Users/zuul/.config/opencode/skills/PAI/SYSTEM/**`; keep runtime-absolute links; remove any “SkillSearch required” instructions. |
| **CreateSkill** | P0 / Foundation / Tooling | Governs all future migrations; must stay deterministic and policy-aligned. | Keep as runbook/router; move deep detail into root docs; ensure workflows enforce base-repo authoring + install. |
| **Documents** | P0 / Docs router | Central router for Docx/Pdf/Pptx/Xlsx; should be small and stable. | Ensure Documents SKILL is a routing table + quick reference; link to subskills via runtime-absolute paths. |
| **Docx / Pdf / Pptx / Xlsx** | P0 / Docs-heavy | Large, reference-heavy; benefits strongly from router + root-doc split. | Routerize each SKILL.md (procedural default ≤80); move extended guides into root docs; keep workflows as runbooks. |
| **Browser** | P1 / Foundation | Cross-cutting verification gate; should be fast to load and unambiguous. | Convert to router + move extended Playwright flows into root docs; keep “screenshot before claiming success” short and explicit. |
| **System** | P1 / Foundation | Governs safety operations; needs deterministic runbooks and explicit confirmations. | Ensure it’s router-first; move long prose into root docs; enforce explicit confirmation for destructive ops. |
| **Agents** | P1 / Foundation | Orchestration rules need to be crisp and stable. | Routerize + move templates/examples to `Examples.md`; keep “when to spawn which agent” in a short table. |
| **Recon / WebAssessment / PromptInjection** | P1 / Security | Security work benefits from explicit scope boundaries and verification steps. | Routerize; add strong negative constraints; move payload catalogs to root docs; ensure verify steps are explicit. |
| **OSINT / PrivateInvestigator** | P1 / Security / OSINT | Sensitive domain; must have tight constraints and explicit permission requirements. | Routerize; add strong MUST NOT constraints; ensure people-finding requires explicit permission. |
| **Apify / BrightData** | P1 / Tooling | Integration-heavy; prone to drift; needs crisp runbooks and escalation logic. | Routerize; move long docs to root references; keep minimal examples. |
| **Telos** | P2 / Personal system | High context gravity; avoid loading heavy context unless explicitly requested. | Convert to router; move long content into root docs; ensure opt-in loading. |
| **SECUpdates** | P2 / Security news | Can drift into long lists; keep query templates deterministic. | Routerize; move long source lists into root docs; ensure repeatable workflows. |
| **Art / Prompting / BeCreative** | P2 / Creative | Should remain creative but bounded; avoid essay SKILL docs. | Treat as Creative archetype: rubrics + templates + pointers to root docs; keep SKILL as router. |
| **VagueifyStories / Aphorisms** | P2 / Creative / Docs-heavy | Likely large; should be bounded creativity with templates, not walls of text. | Creative archetype refactor; move catalogs to `Examples.md`.

## Not yet imported (candidates)

- NarrativeWriting — long-form writing runbooks (structure, pacing, revision loops)
- Science — hypothesis→experiment→analysis workflows (explicit verification)
- PerformanceEngineering — profiling-first workflows for TS services (bun/node)
- ReleaseEngineering — versioning, changelogs, GH releases, rollback steps
- IncidentResponse — severity triage + comms + postmortem templates

When promoting a placeholder to a real skill, prefer CreateSkill’s Procedural archetype unless the domain is inherently creative.
