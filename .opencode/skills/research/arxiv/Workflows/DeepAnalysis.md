# Deep Paper Analysis Workflow

**Purpose:** Conduct comprehensive, systematic analysis of academic papers using the 8-section framework.

**When to Use:**
- You request thorough understanding of a paper
- Academic research requiring detailed analysis
- Comparing methodologies across papers
- Writing literature reviews

---

## Pre-Analysis Preparation

### Step 1: Ensure Paper Availability

Check if paper is locally available:
```
Tool: arxiv-mcp-server_list_papers
```

If not available, download first:
```
Tool: arxiv-mcp-server_download_paper
Parameters:
  paper_id: "[arxiv ID]"
```

### Step 2: Gather Related Context

While primary paper downloads/loads, search for related papers to provide context:
```
Tool: arxiv-mcp-server_search_papers
Parameters:
  query: [key terms from paper title/abstract]
  categories: [relevant categories]
  max_results: 5
```

This provides:
- Historical context (prior work)
- Contemporary landscape
- Follow-up research

### Step 3: Read Primary Paper

Load full paper content:
```
Tool: arxiv-mcp-server_read_paper
Parameters:
  paper_id: "[arxiv ID]"
```

---

## 8-Section Deep Analysis Framework

### Section 1: Executive Summary

**Objective:** Distill the core contribution in accessible terms.

**Include:**
- Problem being addressed (1-2 sentences)
- Proposed solution/approach (1-2 sentences)
- Key results/findings (1-2 sentences)
- Why it matters (1 sentence)

**Format:** 4-6 sentences max, no jargon.

---

### Section 2: Historical Context

**Objective:** Position paper within its research lineage.

**Analyze:**
- What prior work does this build on?
- What gap in knowledge does it address?
- How does it relate to seminal papers in the field?
- What evolution of ideas led to this work?

**Cross-reference** with related papers found in Step 2.

---

### Section 3: Technical Approach

**Objective:** Break down the methodology for practitioners.

**Include:**
- High-level algorithm/approach description
- Key mathematical formulations (if applicable)
- Implementation architecture
- Pseudocode for core algorithms (if valuable)
- Design decisions and their rationale

**Create:**
- Diagrams or flowcharts if helpful
- Step-by-step process breakdown

---

### Section 4: Experimental Validation

**Objective:** Assess the evidence supporting claims.

**Analyze:**
- Datasets/benchmarks used
- Baseline comparisons
- Ablation studies
- Performance metrics
- Statistical significance

**Critical Assessment:**
- Are experiments comprehensive?
- Are baselines appropriate and fair?
- Is statistical rigor sufficient?
- Are results reproducible?

**Tabulate:** Key results with comparisons to baselines.

---

### Section 5: Practical Deployment

**Objective:** Evaluate real-world applicability.

**Consider:**
- Computational requirements (training, inference)
- Data requirements
- Scalability characteristics
- Integration complexity
- Edge cases and failure modes
- Production considerations

**Assess:** Gap between research setting and practical deployment.

---

### Section 6: Theoretical Advances

**Objective:** Identify novel intellectual contributions.

**Analyze:**
- New concepts or frameworks introduced
- Theoretical guarantees provided
- Mathematical innovations
- Paradigm shifts suggested
- Conceptual insights

**Evaluate:** Long-term impact potential on the field.

---

### Section 7: Future Research Directions

**Objective:** Map open questions and opportunities.

**Identify:**
- Limitations acknowledged by authors
- Implicit limitations not discussed
- Natural extensions of the work
- Adjacent problems enabled by this work
- Cross-domain application opportunities

**Prioritize:** By impact and feasibility.

---

### Section 8: Societal Impact

**Objective:** Consider broader implications.

**Analyze:**
- Positive applications and benefits
- Potential for misuse
- Ethical considerations
- Fairness and bias implications
- Environmental impact (if applicable)
- Dual-use concerns

**Note:** Both opportunities and risks.

---

## Analysis Output Format

Present analysis in structured format:

```markdown
# Deep Analysis: [Paper Title]

**arXiv ID:** [ID]
**Authors:** [Names]
**Published:** [Date]
**Categories:** [arXiv categories]

---

## 1. Executive Summary
[4-6 sentence distillation]

## 2. Historical Context
[Position in research lineage]

## 3. Technical Approach
[Methodology breakdown with diagrams/pseudocode]

## 4. Experimental Validation
[Results analysis with tables]

## 5. Practical Deployment
[Real-world applicability assessment]

## 6. Theoretical Advances
[Novel contributions]

## 7. Future Research
[Open questions and directions]

## 8. Societal Impact
[Broader implications]

---

## Key Takeaways
- [Insight 1]
- [Insight 2]
- [Insight 3]

## Related Papers
- [Related paper 1 with brief context]
- [Related paper 2 with brief context]
```

---

## Quality Standards

### Cross-Referencing
- Verify claims against paper text
- Note page/section numbers for key findings
- Cross-check with related papers

### Critical Assessment
- Don't just summarize—evaluate
- Identify strengths AND weaknesses
- Assess reproducibility
- Note what's missing

### Accessibility
- Explain jargon when first used
- Build from fundamentals to advanced
- Use analogies where helpful
- Include visual aids

---

## Multi-Paper Analysis

When analyzing multiple papers together:

1. **Individual Analysis:** Complete 8-section analysis for each
2. **Comparative Table:** Side-by-side comparison of:
   - Problem formulation
   - Approach/methodology
   - Key results
   - Strengths/weaknesses
3. **Synthesis:** What does the combined analysis reveal?
4. **Research Gaps:** What hasn't been addressed?

---

## Time Management

| Analysis Depth | Sections | Approximate Effort |
|---------------|----------|-------------------|
| Quick scan | 1, 3, 4 | 5 minutes |
| Standard | 1-4, 7 | 15 minutes |
| Comprehensive | All 8 | 30+ minutes |

Clarify depth expectation before beginning.
