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

### Evidence + Result Artifacts

Each tool call persists a full copy of the response under the provided `session_dir`:

- Artifacts: `session_dir/research-shell/`
  - `{Provider}Search_<timestamp>_<callId>.json` (raw-ish structured payload + normalized wrapper)
  - `{Provider}Search_<timestamp>_<callId>.md` (human-readable rendering)
- Evidence index: `session_dir/research-shell/evidence/research-shell.jsonl` (JSONL; links to artifact paths)

Tool output is prefixed with the `CALL_ID` and artifact paths to encourage grounding.

For `research-shell_gemini_search`, the MCP server post-processes grounding metadata to:

- Insert IEEE-style in-text citations `[n]` (best-effort)
- Emit a `## References` section with resolved, stable URLs
  - Tracking parameters are stripped
  - Google redirectors like `google.com/url?...` are unwrapped when possible
- If grounding metadata is missing/partial, tool output includes an explicit warning
- If present, `webSearchQueries` are included in tool output and artifacts (compliance)

#### session_dir Allowlist (Security)

The MCP server refuses to write outside an allowlisted root.

- Configure via environment variable: `RESEARCH_SHELL_ALLOWED_SESSION_DIR_PREFIXES`
  - Use the platform path delimiter (`:` on macOS/Linux)
- Default: `~/.config/opencode/scratchpad/sessions/`

To enable it, add this to your `~/.config/opencode/opencode.json`:

```jsonc
{
  "mcp": {
    "research-shell": {
      "type": "local",
      "enabled": false,
      "timeout": 2700000,
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
        "GEMINI_REQUEST_TIMEOUT_SECONDS": "2700",

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

#### MCP Request Timeout

OpenCode enforces an MCP request timeout per server via `mcp.<server>.timeout` (milliseconds). For long-running research (e.g. Gemini), increase `mcp.research-shell.timeout` to cover your longest expected run.

Separately, the research-shell clients support per-provider HTTP timeouts (seconds) via environment variables:

- `GEMINI_REQUEST_TIMEOUT_SECONDS`
- `PERPLEXITY_REQUEST_TIMEOUT_SECONDS`
- `GROK_REQUEST_TIMEOUT_SECONDS`

For full documentation, see the README.md in the repository root.

---

**PAI-OpenCode** - Vanilla PAI 2.4 on OpenCode

Repository: [github.com/Steffen025/pai-opencode](https://github.com/Steffen025/pai-opencode)
