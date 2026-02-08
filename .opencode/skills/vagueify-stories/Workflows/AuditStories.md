# AuditStories Workflow

Audit a blog narrative series to identify brittle claims without making changes.

---

## Purpose

Run Phase 1 only - identify what needs vague-ifying before committing to full cleanup.

**Use this when:**
- User wants to see scope before proceeding
- Evaluating whether series needs vague-ifying
- Planning cleanup effort

---

## Inputs Required

| Parameter | Description | Example |
|-----------|-------------|---------|
| **series_directory** | Path to blog series | `/Users/zuul/Projects/tuonela-private/src/content/blog/tuonela-platform/` |
| **series_name** | Series identifier | `tuonela-platform` |
| **story_pattern** | File pattern to match | `tuonela-platform-story-*.mdx` |

---

## Execution Steps

### Step 1: Create Audit Directory

```bash
TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
AUDIT_DIR="${PAI_DIR}/scratchpad/audit-${series_name}-${TIMESTAMP}"
mkdir -p ${AUDIT_DIR}
```

### Step 2: Count Stories

```bash
cd ${series_directory}
STORY_COUNT=$(ls -1 ${story_pattern} | wc -l)
echo "Found ${STORY_COUNT} stories to audit" > ${AUDIT_DIR}/summary.txt
ls -1 ${story_pattern} | sort > ${AUDIT_DIR}/story-list.txt
```

### Step 3: Grep for Brittle Patterns

Run systematic greps to find all brittle claims:

```bash
# Model names (common AI vendors)
rg -n -i "claude|gpt-?4|gemini|haiku|sonnet|opus|perplexity|grok" \
   ${series_directory}/${story_pattern} \
   > ${AUDIT_DIR}/model-names.txt

# Dollar amounts
rg -n '\$[0-9]+\.[0-9]+|\$[0-9]+' \
   ${series_directory}/${story_pattern} \
   > ${AUDIT_DIR}/dollar-amounts.txt

# Percentages (filter out obvious non-claims later)
rg -n '[0-9]+%' \
   ${series_directory}/${story_pattern} \
   > ${AUDIT_DIR}/percentages.txt

# Platform names (Twitter/X particularly brittle due to rebrand)
rg -n -i "twitter|\\bx\\b|linkedin|reddit|bluesky|facebook|instagram" \
   ${series_directory}/${story_pattern} \
   > ${AUDIT_DIR}/platform-names.txt

# Large numbers indicating metrics
rg -n '[0-9]{3,}\s*(tokens|KB|MB|GB|domains|sources|citations|requests)' \
   ${series_directory}/${story_pattern} \
   > ${AUDIT_DIR}/metrics.txt

# Vendor-specific tools/APIs
rg -n -i "openai|anthropic|google ai|mistral|cohere|together\.ai" \
   ${series_directory}/${story_pattern} \
   > ${AUDIT_DIR}/vendor-apis.txt
```

### Step 4: Analyze Results

For each grep result file, count occurrences and identify patterns:

```bash
# Count instances
echo "Model names: $(cat ${AUDIT_DIR}/model-names.txt | wc -l) instances" >> ${AUDIT_DIR}/summary.txt
echo "Dollar amounts: $(cat ${AUDIT_DIR}/dollar-amounts.txt | wc -l) instances" >> ${AUDIT_DIR}/summary.txt
echo "Percentages: $(cat ${AUDIT_DIR}/percentages.txt | wc -l) instances" >> ${AUDIT_DIR}/summary.txt
echo "Platform names: $(cat ${AUDIT_DIR}/platform-names.txt | wc -l) instances" >> ${AUDIT_DIR}/summary.txt
echo "Metrics: $(cat ${AUDIT_DIR}/metrics.txt | wc -l) instances" >> ${AUDIT_DIR}/summary.txt
echo "Vendor APIs: $(cat ${AUDIT_DIR}/vendor-apis.txt | wc -l) instances" >> ${AUDIT_DIR}/summary.txt
```

### Step 5: Manual Review

**CRITICAL:** Not all matches are brittle claims. Review each category:

#### Model Names
- **Brittle:** "I switched from Claude to GPT-4" (vendor-specific claim)
- **Legitimate:** Character sheet references, code comments mentioning models

#### Percentages
- **Brittle:** "Quality score: 88%" (unverifiable metric)
- **Legitimate:** "aspect_ratio: 16:9" (technical spec), "CSS: width: 50%" (code)

#### Platform Names
- **Brittle:** "LinkedIn discussions showed..." (platform-specific claim)
- **Legitimate:** "LinkedIn scraper tool" (actual tool name), "@username on Twitter" (citation)

#### Metrics
- **Brittle:** "Loaded 352KB into context" (specific measurement)
- **Legitimate:** "32KB token limit" (technical specification)

### Step 6: Generate Audit Report

Create `${AUDIT_DIR}/audit-report.md`:

```markdown
# Brittle Claims Audit: ${series_name}

**Date:** $(date +%Y-%m-%d)
**Stories Audited:** ${STORY_COUNT}
**Directory:** ${series_directory}

---

## Executive Summary

**Total Brittle Claims Found:** [count after manual review]

| Category | Instances | Action Required |
|----------|-----------|----------------|
| Model Names | [X] | [YES/NO/PARTIAL] |
| Dollar Amounts | [Y] | [YES/NO] |
| Percentages | [Z] | [YES/NO/PARTIAL] |
| Platform Names | [W] | [YES/NO/PARTIAL] |
| Precise Metrics | [V] | [YES/NO/PARTIAL] |
| Vendor APIs | [U] | [YES/NO/PARTIAL] |

**Recommendation:** [PROCEED / SKIP / PARTIAL CLEANUP]

---

## Detailed Findings

### 1. Model Names (${count} instances)

**Brittle claims found:**
[List instances that are actual vendor-specific claims]

**Legitimate references:**
[List instances that are OK to keep - character sheets, code, citations]

**Transformation approach:**
- "Claude" → "the analyzer" / "primary analyzer"
- "GPT-4" → "depth-focused model"
- "Gemini" → "the specialist"
- "Haiku/Sonnet/Opus" → "lightweight/standard/high-capability model"

---

### 2. Dollar Amounts (${count} instances)

**All instances:**
[List each with context - dollar amounts are almost always brittle]

**Transformation approach:**
- "$X.XX" → "significantly cheaper/more expensive"
- Cost comparisons → relative language (dropped significantly, became viable)

---

### 3. Percentages (${count} instances)

**Brittle claims found:**
[List percentages that are unverifiable metrics]

**Legitimate uses:**
[List percentages that are technical specs, code, or essential to narrative]

**Transformation approach:**
- "88%" → "high" / "excellent quality"
- "58%" → "majority" / "over half"
- "19%" → "less than one in five" / "abysmal"

**KEEP if narrative-essential:**
Example: "88% quality / 0% coverage" story - these numbers ARE the lesson

---

### 4. Platform Names (${count} instances)

**Brittle claims found:**
[List platform-specific claims that should be genericized]

**Legitimate references:**
[List tool names, API names, citations that should stay specific]

**Transformation approach:**
- "Twitter/X discussions" → "social media discussions"
- "LinkedIn posts" → "professional network content"
- "Reddit threads" → "discussion forum threads"

**KEEP when:**
- Part of a tool name: "linkedin-scraper"
- In a citation: "source: @user on Twitter"
- Technical reference: "LinkedIn API rate limits"

---

### 5. Precise Metrics (${count} instances)

**Brittle claims found:**
[List metrics that invite fact-checking]

**Legitimate specs:**
[List technical specifications that should stay precise]

**Transformation approach:**
- "352KB" → "hundreds of kilobytes"
- "30,000 tokens" → "massive token budget"
- "226 domains" → "hundreds of domains"

**KEEP when:**
- Technical spec: "200K token limit"
- Code reference: "BUFFER_SIZE = 4096"
- API constraint: "max 100 requests/min"

---

### 6. Vendor APIs (${count} instances)

**Brittle claims found:**
[List vendor-specific API references that could be genericized]

**Legitimate references:**
[List where vendor name is technically necessary]

**Transformation approach:**
- "OpenAI API" → "the provider's API" / "LLM provider"
- "Anthropic's Claude" → "the LLM service"

---

## Risk Assessment

**Publication Risk:** [LOW / MEDIUM / HIGH]

- **LOW:** Few brittle claims, easy transformations, low narrative impact
- **MEDIUM:** Moderate claims, some central to stories, requires careful transformation
- **HIGH:** Many claims deeply embedded in narratives, transformation might break flow

**Estimated Effort:** [X] transformations across [Y] stories = [Z] hours

**Recommended Approach:**

[Choose one:]

1. **Full vague-ifying:** Proceed with VagueifySeries workflow
2. **Partial cleanup:** Target only high-risk claims (dollar amounts, vendor names)
3. **Skip for now:** Series has few brittle claims, not worth effort
4. **Manual review:** Claims too embedded in narrative for automated transformation

---

## Sample Transformations

Show 3-5 examples of how specific claims would transform:

**Example 1:**
BEFORE: "I switched from Claude Haiku ($0.25/million) to Sonnet ($3.00/million)"
AFTER: "I switched from a lightweight model to a more capable one, accepting the higher cost"

**Example 2:**
BEFORE: "Quality score: 88%. LinkedIn coverage: 0%"
AFTER: "Quality score: high. Professional network coverage: zero"
[NOTE: Might keep exact numbers if they're THE POINT of the story]

**Example 3:**
[Add 1-2 more relevant to this series]

---

## Next Steps

**If proceeding with vague-ifying:**

1. User approval required - show this report
2. Run VagueifySeries workflow
3. Launch parallel author agents (Phase 2)
4. EIC reviews (Phase 3)
5. Apply fixes (Phase 4)

**If not proceeding:**

Document why in scratchpad and archive this audit for future reference.

---

**Audit complete.** Waiting for user decision: proceed with vague-ifying or skip?
```

### Step 7: Present Report to User

Show the audit report and ask:

```
Found ${total_claims} brittle claims across ${STORY_COUNT} stories in ${series_name}.

Risk level: [LOW/MEDIUM/HIGH]
Estimated effort: [X hours]

Recommendation: [PROCEED / SKIP / PARTIAL]

Should I proceed with full vague-ifying (VagueifySeries workflow)?
```

---

## Output Files

```
${PAI_DIR}/scratchpad/audit-${series_name}-${timestamp}/
├── summary.txt                   # Quick stats
├── story-list.txt                # All stories found
├── model-names.txt               # Raw grep results
├── dollar-amounts.txt            # Raw grep results
├── percentages.txt               # Raw grep results
├── platform-names.txt            # Raw grep results
├── metrics.txt                   # Raw grep results
├── vendor-apis.txt               # Raw grep results
└── audit-report.md               # Final analysis and recommendation
```

---

## Success Criteria

Audit is successful when:

- [ ] All story files found and counted
- [ ] All brittle pattern categories searched
- [ ] Manual review separates brittle claims from legitimate references
- [ ] Risk assessment provided (LOW/MEDIUM/HIGH)
- [ ] Effort estimate calculated
- [ ] Clear recommendation given (PROCEED/SKIP/PARTIAL)
- [ ] Sample transformations demonstrate approach
- [ ] User has enough information to decide whether to proceed

**The audit should give the user confidence that vague-ifying will (or won't) improve the series, and what the effort will be.**
