# Update (AnnualReports)

Update the annual security report source list from upstream.

## Steps

1. Run the source updater:

```bash
bun run ~/.config/opencode/skills/AnnualReports/Tools/UpdateSources.ts
```

2. Inspect the updated sources:

```bash
bun run ~/.config/opencode/skills/AnnualReports/Tools/ListSources.ts
```

## Output

- Updated `../Data/sources.json`
