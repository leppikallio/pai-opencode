# PAI-OpenCode

## For OpenCode

When you start in this directory, determine the installation state:

### If settings.json exists and is configured:
This is an established PAI installation. Read and follow the CORE skill:
```
read skills/CORE/SKILL.md
```

### If this is a fresh installation:
1. The default `settings.json` works out of the box
2. Edit settings with your preferences if desired
3. Start using PAI!

## For Humans

Welcome to PAI-OpenCode v1.0!

1. **Just start**: `opencode` - everything works with defaults
2. **Customize**: Edit `settings.json` for identity and preferences
3. **Learn more**: Read `skills/CORE/SKILL.md`

## MCP: Research Shell (3rd-party research providers)

This repo ships a local MCP server at `~/.config/opencode/mcp/research-shell/`.

It exposes these MCP tools (prefixed by server name):
- `research-shell_perplexity_search`
- `research-shell_gemini_search`
- `research-shell_grok_search`

To enable it, add this to your `~/.config/opencode/opencode.json`:

```jsonc
{
  "mcp": {
    "research-shell": {
      "type": "local",
      "enabled": false,
      "command": ["bash", "-lc", "bun run ~/.config/opencode/mcp/research-shell/index.ts"],
      "environment": {
        "PERPLEXITY_API_KEY": "{env:PERPLEXITY_API_KEY}",
        "PERPLEXITY_MODEL": "sonar-reasoning-pro",
        "PERPLEXITY_MAX_TOKENS": "4096",
        "PERPLEXITY_TEMPERATURE": "0.2",

        "GEMINI_AUTH_METHOD": "api-key",
        "GEMINI_API_KEY": "{env:GEMINI_API_KEY}",
        "GEMINI_MODEL": "gemini-2.0-flash",
        "GEMINI_MAX_TOKENS": "8192",
        "GEMINI_TEMPERATURE": "0.2",
        "GEMINI_SEARCH_ENABLED": "true",

        "GROK_API_KEY": "{env:GROK_API_KEY}",
        "GROK_MODEL": "grok-3-latest",
        "GROK_MAX_TOKENS": "4096",
        "GROK_TEMPERATURE": "0.2",
        "GROK_SEARCH_ENABLED": "true",
        "GROK_RETURN_CITATIONS": "true"
      }
    }
  }
}
```

Then set `enabled: true` once your API keys are present in your shell environment.

### Gemini Auth + Search Grounding

The `research-shell_gemini_search` tool supports two authentication modes. You select the mode via the MCP `environment` values in `~/.config/opencode/opencode.json`:

- `GEMINI_AUTH_METHOD`
  - `"api-key"` (or `"apikey"`): Use `GEMINI_API_KEY`
  - `"oauth"`: Use OAuth credentials
  - If omitted/empty: defaults to `"api-key"`

- `GEMINI_SEARCH_ENABLED`
  - `"true"`: Enables Google Search grounding (adds `google_search` tool to the request)
  - `"false"`: Disables grounding

When grounding is enabled, Gemini responses include `groundingMetadata`, and the client formats a `Sources:` block and returns a list of citation URLs.

#### OAuth Token Storage

When using `GEMINI_AUTH_METHOD: "oauth"`, the client looks for file-based OAuth credentials at:

- `~/.config/gemini-oauth/credentials.json`

This file may contain an `access_token`, optional `refresh_token`, optional `expiry_date`, and a cached `project_id`.

#### Applying Config Changes

The MCP server is a subprocess. After changing `~/.config/opencode/opencode.json`, restart OpenCode so the `research-shell` process picks up the new environment.

For full documentation, see the README.md in the repository root.

---

**PAI-OpenCode** - Vanilla PAI 2.4 on OpenCode

Repository: [github.com/Steffen025/pai-opencode](https://github.com/Steffen025/pai-opencode)
