---
name: pai-upgrade
description: System upgrade analysis and ecosystem monitoring. USE WHEN you need provider-update monitoring, release-note analysis, or source discovery for upgrade opportunities.
---

# pai-upgrade Skill

Runbook-oriented skill for finding, validating, and prioritizing ecosystem upgrades. The skill supports Claude/Anthropic sources as a default set and allows provider-extensible monitoring.
Monitoring now applies learning-aware prioritization from historical quality signals and records recommendation rankings to a history ledger.

## Customization

Before execution, check optional user customizations at:
`~/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/pai-upgrade/`

If present, merge them via `LoadSkillConfig` inputs (for example source catalogs and channel lists).

## Voice Notification

When executing any workflow, send a single voice notification.

```ts
voice_notify({
  message: "Running pai-upgrade workflow",
  title: "pai-upgrade",
})
```

## Workflow Routing

| Workflow | Trigger | File |
|---|---|---|
| **CheckForUpgrades** | check for upgrades, check sources, track provider updates | `<Workflows/CheckForUpgrades.md>` |
| **ResearchUpgrade** | research an upgrade, deep-dive a feature, validate implementation options | `<Workflows/ResearchUpgrade.md>` |
| **ReleaseNotesDeepDive** | analyze release notes, analyze changelog updates, review product announcements | `<Workflows/ReleaseNotesDeepDive.md>` |
| **FindSources** | find upgrade sources, discover monitoring targets, expand coverage | `<Workflows/FindSources.md>` |

## When to Activate This Skill

- **Check**: user asks to monitor for upgrades or source updates.
- **Research**: user asks for deeper analysis of a specific feature or change.
- **Release**: user asks for release/changelog deep analysis.
- **Discover**: user asks to find new source channels, feeds, or repositories.

## Core Coverage

- **Monitoring scope (default):** Anthropic and Claude sources are included (`Tools/Anthropic.ts`, configured feed list).
- **Provider-extensible scope:** additional providers can be added through explicit source lists and workflow inputs.
- **Learning-aware prioritization:** `Tools/MonitorSources.ts` uses `BuildLearningContext.ts` + `RankRecommendations.ts` to adjust priority and score with rationale.
- **Recommendation history ledger:** ranked decisions persist to `State/recommendation-history.jsonl` by default for non-dry-run checks.
- **State tracking:** monitor cursors persist in `State/last-check.json` using stable source IDs.
