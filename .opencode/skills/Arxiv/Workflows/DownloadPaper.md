# Download Paper Workflow

**Purpose:** Download an arXiv paper by ID and prepare it for reading/analysis.

**When to Use:**
- You want to read a specific paper
- Preparing for deep paper analysis
- Building a local paper collection

---

## Workflow Steps

### Step 1: Identify Paper ID

arXiv paper IDs have two formats:
- **New format (2007+):** `YYMM.NNNNN` (e.g., `2312.00752`)
- **Old format (pre-2007):** `category/YYMMNNN` (e.g., `cs.AI/0701001`)

If you provide:
- Full URL: Extract ID from `arxiv.org/abs/[ID]`
- Title: Search first, then download
- Partial ID: Clarify before downloading

### Step 2: Check Local Availability

First, check if paper is already downloaded:

```
Tool: arxiv-mcp-server_list_papers
```

If paper exists locally, skip to Step 5 (read paper).

### Step 3: Download Paper

Use the download tool:

```
Tool: arxiv-mcp-server_download_paper
Parameters:
  paper_id: "[arxiv ID]"
  check_status: false
```

**Status Check Option:**
If download seems stuck or you want to verify conversion status:
```
Tool: arxiv-mcp-server_download_paper
Parameters:
  paper_id: "[arxiv ID]"
  check_status: true
```

### Step 4: Verify Download

After download completes, verify with list_papers:
```
Tool: arxiv-mcp-server_list_papers
```

Confirm paper appears in the list.

### Step 5: Read Paper Content

Once downloaded, read the full content:
```
Tool: arxiv-mcp-server_read_paper
Parameters:
  paper_id: "[arxiv ID]"
```

Returns full paper content in markdown format.

---

## Handling Download Issues

### Paper Not Found
- Verify the arXiv ID is correct
- Check if paper was withdrawn
- Try searching by title/author

### Conversion Pending
- Large papers take time to convert
- Use `check_status: true` to monitor
- Wait and retry

### Network Issues
- Retry download after brief wait
- Check if arXiv is accessible

---

## Batch Downloads

For downloading multiple papers from a search:

1. Run search workflow to find papers
2. Note the arXiv IDs of interest
3. Download each sequentially:
   ```
   download_paper(paper_id="2312.00001")
   download_paper(paper_id="2312.00002")
   download_paper(paper_id="2312.00003")
   ```
4. Verify all downloads with list_papers

---

## Storage Location

Papers are stored at:
- Default: `~/.arxiv-mcp-server/papers/`
- Custom: Set `ARXIV_STORAGE_PATH` environment variable

Each paper is stored as markdown for easy reading and analysis.

---

## Next Steps After Download

After downloading a paper, suggest:
1. **Quick read**: Show abstract and key sections
2. **Deep analysis**: Use DeepAnalysis workflow
3. **Find related**: Search for related papers
4. **Compare**: Download similar papers for comparison
