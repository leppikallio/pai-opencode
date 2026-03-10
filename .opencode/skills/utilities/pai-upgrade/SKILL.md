---
name: pai-upgrade
description: PAI upgrade intelligence for monitored-source analysis and implementation planning. USE WHEN you need provider-update monitoring, release-note analysis, reflection-aware ranking, or bounded upgrade proposals.
---

# PAI Upgrade Intelligence Skill

Runbook-oriented skill for finding, validating, and prioritizing ecosystem upgrades plus internal learning signals. Operator-facing execution enters through `Tools/MonitorSources.ts`.

This skill monitors providers (including `anthropic` as a provider/source context) and keeps the recommendation pipeline provider-extensible.

Canonical report contract is:

**Discoveries → Recommendations → Implementation Targets**

Internal learnings may outrank external discoveries when ranking evidence is stronger.

## Local Config and State Contract

- **Live monitored-source config (local runtime):**
  - `~/.config/opencode/MEMORY/STATE/pai-upgrade/config/sources.v2.json`
  - `~/.config/opencode/MEMORY/STATE/pai-upgrade/config/sources.json`
  - `~/.config/opencode/MEMORY/STATE/pai-upgrade/config/youtube-channels.json`
- **Live runtime outputs (local runtime):**
  - `~/.config/opencode/MEMORY/STATE/pai-upgrade/state/last-check.json`
  - `~/.config/opencode/MEMORY/STATE/pai-upgrade/state/recommendation-history.jsonl`
  - `~/.config/opencode/MEMORY/STATE/pai-upgrade/state/run-history.jsonl`
  - `~/.config/opencode/MEMORY/STATE/pai-upgrade/state/youtube-videos.json`
  - `~/.config/opencode/MEMORY/STATE/pai-upgrade/state/transcripts/youtube/`
- **Repo templates (blank bootstrap artifacts only):**
  - `Templates/sources.v2.json`
  - `Templates/sources.json`
  - `Templates/youtube-channels.json`

The template files are blank templates for bootstrap/reference only. They are not live operator config.
If local migration is needed, use a **one-time local migration** script outside permanent install/runtime tooling.

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
| **MineReflections** | mine reflections, check reflections, reflection insights | `<Workflows/MineReflections.md>` |
| **AlgorithmUpgrade** | algorithm upgrade, improve the algorithm, algorithm improvements | `<Workflows/AlgorithmUpgrade.md>` |
| **ResearchUpgrade** | research an upgrade, deep-dive a feature, validate implementation options | `<Workflows/ResearchUpgrade.md>` |
| **ReleaseNotesDeepDive** | analyze release notes, analyze changelog updates, review product announcements | `<Workflows/ReleaseNotesDeepDive.md>` |
| **FindSources** | find upgrade sources, discover monitoring targets, expand coverage | `<Workflows/FindSources.md>` |

## When to Activate This Skill

- **Check**: user asks to monitor for upgrades or source updates.
- **Reflect**: user asks to mine or review internal reflection signals.
- **Algorithm Upgrade**: user asks to improve the algorithm using reflection evidence.
- **Research**: user asks for deeper analysis of a specific feature or change.
- **Release**: user asks for release/changelog deep analysis.
- **Discover**: user asks to find new source channels, feeds, or repositories.

## Core Coverage

- **Monitoring scope (default):** `anthropic` provider sources are included (via `Tools/MonitorSources.ts` with configured feed list and provider filters).
- **Provider-extensible scope:** additional providers can be added through explicit source lists and workflow inputs.
- **Legacy fallback contract:** when monitor config falls back to `sources.json` (v1), provider scope is explicitly limited to `anthropic` and `all` until `sources.v2.json` is restored.
- **Learning-aware prioritization:** `Tools/MonitorSources.ts` adjusts priority and score with rationale.
- **Recommendation history ledger:** ranked decisions persist to `~/.config/opencode/MEMORY/STATE/pai-upgrade/state/recommendation-history.jsonl` by default for non-dry-run checks.
- **State tracking:** monitor cursors persist in `~/.config/opencode/MEMORY/STATE/pai-upgrade/state/last-check.json` using stable source IDs.
- **YouTube source catalog input:** `~/.config/opencode/MEMORY/STATE/pai-upgrade/config/youtube-channels.json` is an optional monitored-source catalog extension consumed by `Tools/MonitorSources.ts`.
- **YouTube runtime state output:** source scans may persist normalized video metadata in `~/.config/opencode/MEMORY/STATE/pai-upgrade/state/youtube-videos.json`.
- **YouTube transcript runtime state output:** source scans may persist transcript artifacts under `~/.config/opencode/MEMORY/STATE/pai-upgrade/state/transcripts/youtube/`.
- **Operator path constraint:** monitor YouTube source ingestion through `Tools/MonitorSources.ts` only.

## Session Trigger Mode

The OpenCode unified plugin can run upgrade monitoring automatically on `session.created` (primary sessions only).

- Trigger is **non-blocking** and guarded by a cooldown.
- Default behavior: enabled, provider `anthropic`, 7-day scan window, 24-hour cooldown.
- Results still flow through the same learning-aware ranking and recommendation-history ledger.

Environment toggles:

- `PAI_UPGRADE_SESSION_TRIGGER=0|false|off` to disable auto-trigger.
- `PAI_UPGRADE_SESSION_TRIGGER_PROVIDER=<provider|all>` to change provider scope.
- `PAI_UPGRADE_SESSION_TRIGGER_DAYS=<n>` to change lookback days.
- `PAI_UPGRADE_SESSION_TRIGGER_COOLDOWN_HOURS=<n>` to change trigger cadence.
- `PAI_UPGRADE_SESSION_TRIGGER_TIMEOUT_MS=<n>` to cap single-run wall-clock time.
