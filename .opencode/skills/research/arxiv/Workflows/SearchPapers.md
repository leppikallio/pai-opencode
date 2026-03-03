# Search Papers Workflow

**Purpose:** Discover relevant academic papers on arXiv using optimized queries and filters.

**When to Use:**
- You want to find papers on a specific topic
- Literature review or research exploration
- Finding recent or foundational work in a domain

---

## Workflow Steps

### Step 1: Understand the Search Intent

Before searching, clarify:
- **Topic/Keywords**: What concepts are being researched?
- **Time Frame**: Recent work only? Historical/foundational? All time?
- **Domain**: Which arXiv categories apply?
- **Depth**: Quick survey (5 papers) or comprehensive (20+ papers)?

### Step 2: Construct Optimized Query

**Query Patterns:**

| Intent | Query Pattern | Example |
|--------|--------------|---------|
| Exact concept | `"quoted phrase"` | `"transformer architecture"` |
| Multiple terms | `term1 OR term2` | `"AI agents" OR "autonomous agents"` |
| Title search | `ti:"phrase"` | `ti:"attention mechanism"` |
| Author search | `au:"name"` | `au:"Hinton"` |
| Abstract search | `abs:"keyword"` | `abs:"reinforcement learning"` |
| Exclusion | `ANDNOT term` | `"deep learning" ANDNOT "survey"` |

**Combine for precision:**
```
ti:"reinforcement learning" AND abs:"multi-agent" ANDNOT "survey"
```

### Step 3: Select Categories

Map domain to arXiv categories:

| Domain | Categories |
|--------|-----------|
| AI/ML | cs.AI, cs.LG |
| NLP | cs.CL |
| Computer Vision | cs.CV |
| Multi-Agent | cs.MA |
| Security | cs.CR |
| Robotics | cs.RO |
| Software | cs.SE |
| Theory | cs.CC, cs.DS |

**Best practice:** Always include 1-3 relevant categories to improve result quality.

### Step 4: Set Date Filters

| Goal | Filter |
|------|--------|
| Latest research | `date_from: "2024-01-01"` |
| Recent (2-3 years) | `date_from: "2022-01-01"` |
| Foundational (pre-2015) | `date_to: "2015-12-31"` |
| Specific period | Both `date_from` and `date_to` |

### Step 5: Execute Search

Use the `arxiv-mcp-server_search_papers` tool:

```
Tool: arxiv-mcp-server_search_papers
Parameters:
  query: [constructed query]
  categories: [array of categories]
  date_from: [YYYY-MM-DD if needed]
  date_to: [YYYY-MM-DD if needed]
  max_results: [5-50, default 10]
  sort_by: "relevance" (default) or "date"
```

### Step 6: Present Results

Format results clearly:
1. **Paper Title** (arXiv ID)
   - Authors
   - Categories
   - Date
   - Abstract summary (2-3 sentences)
   - Relevance to query

### Step 7: Offer Next Steps

Based on results, suggest:
- Download specific papers for deep analysis
- Refine search with different terms
- Explore related categories
- Find papers by specific authors

---

## Example Searches

**Multi-agent reinforcement learning (recent):**
```
query: "multi-agent" AND "reinforcement learning"
categories: ["cs.MA", "cs.LG", "cs.AI"]
date_from: "2023-01-01"
max_results: 15
sort_by: "relevance"
```

**Foundational attention papers:**
```
query: ti:"attention" AND abs:"transformer"
categories: ["cs.CL", "cs.LG"]
date_to: "2018-12-31"
max_results: 10
```

**Author's recent work:**
```
query: au:"Bengio" AND "deep learning"
categories: ["cs.LG"]
date_from: "2022-01-01"
max_results: 20
```

---

## Troubleshooting

**Too few results:**
- Broaden query (remove quotes, use OR)
- Remove category filters
- Extend date range

**Too many irrelevant results:**
- Add more specific quoted phrases
- Use field prefixes (ti:, abs:)
- Add ANDNOT exclusions
- Narrow categories

**No results:**
- Check query syntax (quotes, operators)
- Verify category codes are correct
- Try simpler query terms
