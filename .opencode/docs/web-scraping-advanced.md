# Web Scraping Advanced

This is a short runtime reference for more advanced scraping approaches.

## Preferred Approach

1. Use built-in tools (`webfetch`, `brightdata_*`, `apify_*`) when available.
2. Prefer provider integrations under `~/.config/opencode/mcp/` for durable scraping.

## Notes

- Always minimize tokens by filtering/transforming in TypeScript before returning content.
- Prefer deterministic extraction and structured output when possible.
