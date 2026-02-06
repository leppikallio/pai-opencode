---
name: CitationCreation
description: IEEE citation formatting rules and templates. USE WHEN you need to format IEEE references OR create an IEEE reference list OR ask how to cite a source in IEEE style.
---

# CitationCreation

IEEE citation format rules and templates based on the IEEE Editorial Style Manual (July 2024).

## Customization

**Before executing, check for user customizations at:**
`~/.config/opencode/skills/PAI/USER/SKILLCUSTOMIZATIONS/CitationCreation/` (optional)

If this directory exists, load and apply any `PREFERENCES.md`, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

## Voice Notification

**When executing a workflow, do BOTH:**

1. **Send voice notification**:
   Use the `voice_notify` tool:

- `message`: "Running the WORKFLOWNAME workflow in the CitationCreation skill"

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **Reference** | Format IEEE citations or reference entries | `Workflows/Reference.md` |

## Examples

**Example 1: Format a single website reference**
```
User: "Cite this webpage in IEEE: https://example.com/article"
-> Invokes Reference workflow
-> Requests missing metadata (author, page title, access date)
-> Returns IEEE in-text citation [1] + formatted reference entry
```

**Example 2: Build a references section for a report**
```
User: "Create an IEEE reference list for these 6 sources"
-> Invokes Reference workflow
-> Assigns numbers in order of first appearance
-> Outputs a complete ## References section with [1]...[6]
```

## Quick Reference - In-Text Citations

```
Single citation:     [1]
Multiple citations:  [1], [3], [5]
Range of citations:  [1]-[3]
Specific reference:  [1, Fig. 2], [1, eq. (8)], [1, Sec. IV]
```

**Rules:**
- Place citation number in square brackets [#]
- Place AFTER punctuation (periods, commas) but BEFORE colons/semicolons
- Same source = same number throughout document
- Do NOT use "in reference [1]" - use "in [1]"
- Do NOT include author name with number unless essential to sentence meaning

## Quick Reference - Reference List

References numbered sequentially in **order of first citation** (NOT alphabetical).

### Author Format

| Authors | Format |
|---------|--------|
| 1 author | A. B. Surname |
| 2 authors | A. B. Surname and C. D. Surname |
| 3-6 authors | A. B. Surname, C. D. Surname, and E. F. Surname |
| 7+ authors | A. B. Surname et al. |

**Note:** First initial(s), then surname. No comma before "et al."

## Reference Templates by Type

### Journal Article

```
[#] A. B. Author, "Title of article," Abbrev. Journal Title, vol. X, no. Y, pp. ZZ-ZZ, Abbrev. Month Year.
```

**Example:**
```
[1] S. Chen and A. Kumar, "Multi-agent coordination for enterprise AI," IEEE Trans. Neural Netw. Learn. Syst., vol. 35, no. 4, pp. 1234-1245, Apr. 2025.
```

### Conference Paper

```
[#] A. B. Author, "Title of paper," in Proc. Name of Conf., City, Country, Year, pp. XX-XX.
```

**Example:**
```
[2] M. Zhang et al., "Agentic AI architectures for automation," in Proc. NeurIPS, Vancouver, Canada, 2024, pp. 5678-5689.
```

### Book

```
[#] A. B. Author, Title of Book, Xth ed. City, State/Country: Publisher, Year.
```

**Example:**
```
[3] J. Russell and P. Norvig, Artificial Intelligence: A Modern Approach, 4th ed. Hoboken, NJ, USA: Pearson, 2021.
```

### Book Chapter

```
[#] A. B. Author, "Title of chapter," in Title of Book, A. B. Editor, Ed. City, State/Country: Publisher, Year, pp. XX-XX.
```

### Website/Online Source

```
[#] A. Author. "Title of page." Website Name. URL (accessed Abbrev. Month Day, Year).
```

**Example:**
```
[4] McKinsey & Company. "State of AI in 2025." McKinsey.com. https://mckinsey.com/ai-report-2025 (accessed Nov. 25, 2025).
```

### Online Article (with date)

```
[#] A. Author, "Title of article," Publication, Abbrev. Month Day, Year. [Online]. Available: URL
```

**Example:**
```
[5] S. Brown, "Enterprise AI adoption accelerates," TechCrunch, Nov. 15, 2025. [Online]. Available: https://techcrunch.com/ai-enterprise-2025
```

### Technical Report

```
[#] A. Author, "Title of report," Company/Institution, City, State/Country, Rep. No., Abbrev. Month Year.
```

**Example:**
```
[6] Gartner, "Magic Quadrant for AI platforms," Gartner, Inc., Stamford, CT, USA, Rep. G00789012, Oct. 2025.
```

### arXiv Preprint

```
[#] A. Author, "Title of paper," arXiv:XXXX.XXXXX, Abbrev. Month Year.
```

**Example:**
```
[7] Y. Wang et al., "Survey of LLM agent frameworks," arXiv:2411.12345, Nov. 2024.
```

### Standard

```
[#] Title of Standard, Standard No., Year.
```

**Example:**
```
[8] IEEE Standard for Software Quality Assurance Processes, IEEE Std 730-2014, 2014.
```

### Patent

```
[#] A. B. Author, "Title of patent," U.S. Patent X XXX XXX, Abbrev. Month Day, Year.
```

### Thesis/Dissertation

```
[#] A. B. Author, "Title of thesis," Ph.D. dissertation, Dept., Univ., City, State/Country, Year.
```

## Style Rules

### Title Formatting

| Element | Style |
|---------|-------|
| Article/chapter titles | "In quotation marks" |
| Book/journal titles | *In italics* |
| Abbreviations | Use standard IEEE abbreviations |

### Common Abbreviations

| Full | Abbreviation |
|------|--------------|
| Transactions | Trans. |
| Proceedings | Proc. |
| Conference | Conf. |
| International | Int. |
| Volume | vol. |
| Number | no. |
| Pages | pp. |
| January | Jan. |
| February | Feb. |
| ... | ... |

### Month Abbreviations

Jan., Feb., Mar., Apr., May, June, July, Aug., Sept., Oct., Nov., Dec.

## For Research Agents

When generating research output:

1. **Collect citation data during research:**
   - Author names (all of them)
   - Full title
   - Publication/source name
   - Date (specific as possible)
   - URL for online sources
   - DOI if available

2. **Format inline citations:**
   - Use [#] format
   - Number in order of appearance
   - Be consistent

3. **Create reference list:**
   - Place at end of research file
   - Use appropriate template for each source type
   - Include access date for online sources

## Supplementary Resources

- Full IEEE Editorial Style Manual: `https://journals.ieeeauthorcenter.ieee.org/wp-content/uploads/sites/7/IEEE-Editorial-Style-Manual-for-Authors.pdf`
- Citation validation skill: `~/.config/opencode/skills/CitationValidation/`
- Full extracted reference guide (imported as-is): `CLAUDE.md`
