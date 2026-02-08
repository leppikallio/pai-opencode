# Fetch (annual-reports)

Download a specific report (PDF or web URL) from the sources list.

## Steps

1. List sources to find vendor/report name:

```bash
bun run ~/.config/opencode/skills/annual-reports/Tools/ListSources.ts
```

2. Fetch report:

```bash
bun run ~/.config/opencode/skills/annual-reports/Tools/FetchReport.ts <vendor> <report-name>
```

## Output

- Report saved under `Reports/`

