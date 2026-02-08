---
name: arxiv
description: Academic research paper discovery, download, and deep analysis using arXiv MCP server. USE WHEN user asks to search arXiv OR find papers OR download a paper OR analyze a paper OR literature review.
---

## Customization

**Before executing, check for user customizations at:**
`~/.config/opencode/skills/CORE/USER/SKILLCUSTOMIZATIONS/arxiv/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

# arxiv

Academic research paper discovery, download, and deep analysis system using the arXiv MCP server.

## Voice Notification

**When executing a workflow, do BOTH:**

1. **Send voice notification**:
   Use the `voice_notify` tool:

- `message`: "Running the WORKFLOWNAME workflow from the arxiv skill"

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **SearchPapers** | Search/discover papers ("search arxiv", "find papers on", "literature review") | `Workflows/SearchPapers.md` |
| **DownloadPaper** | Download a paper ("download paper 2312.00752", arXiv URL/ID) | `Workflows/DownloadPaper.md` |
| **DeepAnalysis** | Deep paper analysis ("analyze paper", "deep review", "what does this paper say") | `Workflows/DeepAnalysis.md` |

Direct tool use (no workflow required):
- List downloaded papers: `arxiv-mcp-server_list_papers`
- Read paper content: `arxiv-mcp-server_read_paper`

## Examples

**Example 1: Search**
```
User: "Search arxiv for multi-agent systems papers from 2024"
→ Invokes SearchPapers workflow
→ Executes arXiv search with categories + date filters
→ Returns a ranked list of relevant papers
```

**Example 2: Download and analyze**
```
User: "Download and analyze paper 2312.00752"
→ Invokes DownloadPaper workflow
→ Downloads paper (or reuses local copy)
→ Invokes DeepAnalysis workflow for structured analysis
```

**Example 3: Read a paper**
```
User: "Read paper 2312.00752"
→ Uses arxiv-mcp-server_read_paper
→ Returns the full paper content in markdown
```

---

## Available MCP Tools

The arxiv-mcp-server provides four primary tools:

| Tool | Purpose | Parameters |
|------|---------|------------|
| `arxiv-mcp-server_search_papers` | Search arXiv with filters | query, categories, date_from, date_to, max_results, sort_by |
| `arxiv-mcp-server_download_paper` | Download paper by ID | paper_id, check_status |
| `arxiv-mcp-server_list_papers` | List all downloaded papers | (none) |
| `arxiv-mcp-server_read_paper` | Read paper content | paper_id |

---

## Search Query Best Practices

### Query Construction
- **Use quoted phrases** for exact matches: `"multi-agent systems"`, `"neural networks"`
- **Combine with OR** for related concepts: `"AI agents" OR "software agents"`
- **Field-specific searches**:
  - `ti:"exact title phrase"` - title only
  - `au:"author name"` - author search
  - `abs:"keyword"` - abstract only
- **Use ANDNOT** to exclude: `"machine learning" ANDNOT "survey"`

### Category Filtering (Highly Recommended)
| Category | Domain |
|----------|--------|
| cs.AI | Artificial Intelligence |
| cs.MA | Multi-Agent Systems |
| cs.LG | Machine Learning |
| cs.CL | Computation and Language (NLP) |
| cs.CV | Computer Vision |
| cs.RO | Robotics |
| cs.CR | Cryptography and Security |
| cs.SE | Software Engineering |

### Date Filtering
- `date_to: "2015-12-31"` - for foundational/classic work
- `date_from: "2023-01-01"` - for recent developments
- Results sorted by RELEVANCE by default (most relevant first)

---

## Deep Paper Analysis Framework

When performing comprehensive paper analysis, follow this 8-section framework:

### 1. Executive Summary
- Main contributions and problems addressed
- Key findings in 2-3 sentences

### 2. Historical Context
- Position within research domain
- Prior work and how this builds on it

### 3. Technical Approach
- Methodology breakdown
- Implementation specifics
- Algorithms and techniques used

### 4. Experimental Validation
- Benchmarks and datasets
- Comparative performance analysis
- Statistical rigor assessment

### 5. Practical Deployment
- Real-world applicability
- Implementation considerations
- Computational requirements

### 6. Theoretical Advances
- Novel contributions
- Paradigm shifts introduced
- Mathematical foundations

### 7. Future Research
- Open questions identified
- Suggested directions
- Limitations acknowledged

### 8. Societal Impact
- Ethical considerations
- Broader implications
- Potential misuse concerns

---

## Workflow Files

- `Workflows/SearchPapers.md` - Optimized paper discovery workflow
- `Workflows/DownloadPaper.md` - Paper download and verification
- `Workflows/DeepAnalysis.md` - Comprehensive 8-section analysis

---

## Quick Usage Examples

**Search for recent AI agent papers:**
```
Search arxiv for multi-agent systems papers from 2024
```
→ Uses search_papers with categories=["cs.MA", "cs.AI"], date_from="2024-01-01"

**Download and analyze a specific paper:**
```
Download and analyze paper 2312.00752
```
→ Uses download_paper, then read_paper, then DeepAnalysis workflow

**Find foundational work:**
```
Find classic BDI architecture papers before 2010
```
→ Uses search_papers with ti:"BDI" AND abs:"belief desire intention", date_to="2010-12-31"

---

## Integration Notes

- Papers are stored locally at `~/.arxiv-mcp-server/papers` (configurable via ARXIV_STORAGE_PATH)
- Always check `list_papers` first to see what's already downloaded
- When analyzing papers, search for related work to provide context
- Cross-reference findings across multiple papers when possible

