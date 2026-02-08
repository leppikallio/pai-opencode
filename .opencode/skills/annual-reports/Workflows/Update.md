# Update (annual-reports)

Update the annual security report source list from upstream.

## Steps

1. Run the source updater:

```bash
bun run ~/.config/opencode/skills/annual-reports/Tools/UpdateSources.ts
```

2. Inspect the updated sources:

```bash
bun run ~/.config/opencode/skills/annual-reports/Tools/ListSources.ts
```

## Output

- Updated `../Data/sources.json`

