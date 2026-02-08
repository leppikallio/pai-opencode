---
name: fabric
description: 240+ prompt patterns for content analysis and transformation. USE WHEN fabric, extract wisdom, summarize, threat model.
---

## Customization

**Before executing, check for user customizations at:**
`~/.config/opencode/skills/CORE/USER/SKILLCUSTOMIZATIONS/fabric/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

## Voice Notification

**When executing a workflow, do BOTH:**

1. **Send voice notification**:
   Use the `voice_notify` tool:

- `message`: "Running the WORKFLOWNAME workflow in the fabric skill to ACTION"
User: "Use fabric to extract wisdom from this article"
-> Invokes ExecutePattern workflow
-> Selects extract_wisdom pattern
-> Reads Patterns/extract_wisdom/system.md
-> Applies pattern to content
-> Returns structured IDEAS, INSIGHTS, QUOTES, etc.
```

**Example 2: Update patterns**
```
User: "Update fabric patterns"
-> Invokes UpdatePatterns workflow
-> Runs git pull from upstream fabric repository
-> Syncs patterns to local Patterns/ directory
-> Reports pattern count
```

**Example 3: Create threat model**
```
User: "Use fabric to create a threat model for this API"
-> Invokes ExecutePattern workflow
-> Selects create_threat_model pattern
-> Applies STRIDE methodology
-> Returns structured threat analysis
```

---

## Quick Reference

### Pattern Execution (Native - No CLI Required)

Instead of calling `fabric -p pattern_name`, PAI executes patterns natively:
1. Reads `Patterns/{pattern_name}/system.md`
2. Applies pattern instructions directly as prompt
3. Returns results without external CLI calls

### When to Use Fabric CLI Directly

Only use `fabric` command for:
- **`-y URL`** - YouTube transcript extraction
- **`-u URL`** - URL content fetching (when native fetch fails)

### Routing Priority (Fabric-First)

When intent matches a fabric pattern, fabric takes precedence over generic research tools.

**Always route to fabric first when any of these are true:**
- The request explicitly says "fabric"
- The requested output matches a known pattern (e.g., `extract_wisdom`, `summarize`, `create_threat_model`)
- The request is "extract wisdom" from a URL, article, transcript, or video

**YouTube-specific priority:**
1. Use fabric's YouTube transcript path first (`fabric -y URL`)
2. Apply the selected pattern (usually `extract_wisdom`) natively from `Patterns/{pattern}/system.md`
3. Return the structured output sections required by the pattern

**Fallback rule (only after fabric path fails):**
- Use MCP/web researcher tools (Gemini/Perplexity/Grok/websearch) only as fallback
- Explicitly state that fallback was used and why fabric-first could not complete
- Keep the same requested output shape if fallback is used

### Most Common Patterns

| Intent | Pattern | Description |
|--------|---------|-------------|
| Extract insights | `extract_wisdom` | IDEAS, INSIGHTS, QUOTES, HABITS |
| Summarize | `summarize` | General summary |
| 5-sentence summary | `create_5_sentence_summary` | Ultra-concise |
| Threat model | `create_threat_model` | Security threat analysis |
| Analyze claims | `analyze_claims` | Fact-check claims |
| Improve writing | `improve_writing` | Writing enhancement |
| Code review | `review_code` | Code analysis |
| Main idea | `extract_main_idea` | Core message extraction |

### Full Pattern Catalog

See `PatternCatalog.md` for complete list of 240+ patterns organized by category.

---

## Native Pattern Execution

**How it works:**

```
User Request → Pattern Selection → Read system.md → Apply → Return Results
```

**Pattern Structure:**
```
Patterns/
├── extract_wisdom/
│   └── system.md       # The prompt instructions
├── summarize/
│   └── system.md
├── create_threat_model/
│   └── system.md
└── ...240+ patterns
```

Each pattern's `system.md` contains the full prompt that defines:
- IDENTITY (who the AI should be)
- PURPOSE (what to accomplish)
- STEPS (how to process input)
- OUTPUT (structured format)

---

## Pattern Categories

| Category | Count | Examples |
|----------|-------|----------|
| **Extraction** | 30+ | extract_wisdom, extract_insights, extract_main_idea |
| **Summarization** | 20+ | summarize, create_5_sentence_summary, youtube_summary |
| **Analysis** | 35+ | analyze_claims, analyze_code, analyze_threat_report |
| **Creation** | 50+ | create_threat_model, create_prd, create_mermaid_visualization |
| **Improvement** | 10+ | improve_writing, improve_prompt, review_code |
| **Security** | 15 | create_stride_threat_model, create_sigma_rules, analyze_malware |
| **Rating** | 8 | rate_content, judge_output, rate_ai_response |

---

## Integration

### Feeds Into
- **Research** - Fabric patterns enhance research analysis
- **Blogging** - Content summarization and improvement
- **Security** - Threat modeling and analysis

### Uses
- **fabric CLI** - For YouTube transcripts (`-y`) and URL fetching (`-u`)
- **Native execution** - Direct pattern application (preferred)

---

## File Organization

| Path | Purpose |
|------|---------|
| `~/.config/opencode/skills/fabric/Patterns/` | Local pattern storage (240+) |
| `~/.config/opencode/skills/fabric/PatternCatalog.md` | Full pattern documentation |
| `~/.config/opencode/skills/fabric/Workflows/` | Execution workflows |
| `~/.config/opencode/skills/fabric/Tools/` | CLI utilities |

---

## Changelog

### 2026-02-08
- Added explicit fabric-first routing priority for pattern-matching requests
- Added YouTube-specific priority: `fabric -y URL` before generic MCP research tools
- Added fallback policy requiring explicit reason when non-fabric tools are used

### 2026-01-18
- Initial skill creation (extracted from CORE/Tools/fabric)
- Native pattern execution (no CLI dependency for most patterns)
- Two workflows: ExecutePattern, UpdatePatterns
- 240+ patterns organized by category
- PAI Pack ready structure
