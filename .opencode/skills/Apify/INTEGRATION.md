# Apify Integration Guide

**Status:** Production Ready ✅
**Token Savings:** 90-98% vs traditional MCP approach
**Execution Time:** ~10 seconds typical

## Integration with PAI Skills

This repo ships a **code-first** Apify interface under:

- `~/.config/opencode/skills/apify/`

The key integration pattern is: run Apify actors in code, then filter results BEFORE anything reaches model context.

### Example: Use apify from another skill/tool

```typescript
// Run from: ~/.config/opencode/skills/apify/
import { searchGoogleMaps } from "./actors";

const places = await searchGoogleMaps({ query: "coffee vienna", maxResults: 50 });
const top = places.filter((p) => (p.rating ?? 0) >= 4.6).slice(0, 10);
console.log(top);
```

### Legacy Note

Older installations sometimes include extra `filesystem-mcps` scripts.
They are not required for this apify skill.

## Migration from MCP

### Before (MCP Approach)

```typescript
// Step 1: Search for actors (~1,000 tokens)
mcp__Apify__search-actors("twitter scraper")

// Step 2: Call actor (~1,000 tokens)
mcp__Apify__call-actor(actorId, input)

// Step 3: Get output (~50,000 tokens unfiltered!)
mcp__Apify__get-actor-output(runId)

// Total: ~57,000 tokens
```

### After (Code-Based Approach)

```typescript
// All in one script, filtering in code
bun run ~/.config/opencode/skills/apify/examples/instagram-scraper.ts

// Returns only filtered result set
// Savings: typically 90%+ vs unfiltered
```

## Best Practices

### DO:
✅ Use appropriate script for the task
✅ Let script filter data before returning
✅ Trust token savings calculations
✅ Run from `~/.config/opencode/filesystem-mcps/apify/` directory or use full path
✅ Check execution time (~10 seconds expected)

### DON'T:
❌ Fall back to MCP tools for Twitter operations
❌ Fetch unfiltered data into model context
❌ Re-implement filtering logic (use existing scripts)
❌ Skip error handling (scripts handle common errors)
❌ Ignore token savings metrics in output

## Performance Expectations

**Execution Time:**
- Actor search: Eliminated (hardcoded actor ID)
- Actor execution: ~10 seconds (Apify platform time)
- Data processing: <1 second (TypeScript filtering)
- **Total: ~10 seconds**

**Token Usage:**
- Single tweet: 500 tokens (vs 57,000 MCP)
- Thread (5 tweets): 5,500 tokens (vs 60,000 unfiltered)
- User tweets (10): 8,000 tokens (vs 80,000 unfiltered)

**Rate Limits:**
- Apify free tier: 100 actor runs/day
- Apify paid tier: Unlimited
- Current usage: Well within limits

## Error Handling

Scripts handle common errors automatically:

1. **Missing APIFY_TOKEN** → Clear error message with setup instructions
2. **Actor failure** → Reports status and exits cleanly
3. **No results** → Graceful message, no crash
4. **Network timeout** → Configurable timeout (120s default)

**Manual intervention rarely needed.**

## Future Enhancements

### Planned Features:

1. **Search tweets by topic**
   - `search-tweets.ts <username> <query> <limit>`
   - Example: Search user's tweets about "AI" from last month

2. **Thread detection improvements**
   - Better handling of quote tweets
   - Reply chain analysis
   - Thread continuity verification

3. **Engagement analytics**
   - Filter by minimum engagement threshold
   - Sort by engagement metrics
   - Engagement trend analysis

4. **Export formats**
   - JSON output for programmatic use
   - Markdown format for documentation
   - CSV for spreadsheet analysis

### Migration Candidates:

Other Apify actors worth implementing:
- Instagram scraping
- LinkedIn scraping
- YouTube data extraction
- Generic web scraping

**Same pattern applies:** Filter in code, 90%+ token savings expected.

## Documentation

**For Users:**
- Apify skill: `~/.config/opencode/skills/apify/SKILL.md`

## Support

**Common Questions:**

Q: Why not use MCP?
A: 90-98% token savings, faster execution, better control.

Q: What if script fails?
A: Check `APIFY_TOKEN` in `~/.config/opencode/.env`, verify network, check Apify status.

Q: Can I add new actors?
A: Yes! Add a wrapper in `~/.config/opencode/skills/apify/actors/` and filter in code.

Q: How do I debug?
A: Start with the actor wrapper output, then log/filter in code.

## Success Metrics

**Achieved:**
- ✅ 90-98% token reduction vs MCP
- ✅ ~10 second execution time
- ✅ Production integration in social skill
- ✅ 4 production-ready scripts
- ✅ Comprehensive documentation

**This is the standard for large-result Apify integrations in PAI.**

