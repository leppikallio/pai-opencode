---
name: ScrapingReference
description: Web scraping and MCP system routing details. Reference material extracted from SKILL.md for on-demand loading.
created: 2025-12-17
extracted_from: SKILL.md lines 993-1022
---

# Web Scraping & MCP Systems Reference

**Quick reference in SKILL.md** → For full details, see this file

---

## 🌐 Web Scraping & MCP Systems

### Route Triggers
- User says "use the MCP" or "use Bright Data" or "use Apify" → Use MCP Skill
- User mentions "scrape my site" or "scrape website" → Use MCP Skill
- User asks "extract data from" or "get data from website" → Use MCP Skill
- User mentions "Instagram scraper" or "LinkedIn data" or social media scraping → Use MCP Skill
- User asks "Google Maps businesses" or lead generation → Use MCP Skill
- Questions about "web scraping" or "data extraction" → Use MCP Skill

### Web Scraping: Use MCP Runtime

**MCP is the runtime integration point for web scraping providers.**
- Location: `~/.config/opencode/mcp/`
- Implementation: TypeScript wrappers that call provider APIs directly
- Goal: filter results in code before adding to model context

**Why TypeScript Wrappers (not old MCP protocol):**
- Direct API calls (faster, more efficient)
- Filter results in code before sending to model (massive token savings)
- Full control over data processing
- No MCP protocol overhead

---

**See Also:**
- SKILL.md > Web Scraping - Condensed trigger
- `~/.config/opencode/mcp/` - Runtime MCP implementations
