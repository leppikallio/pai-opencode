# VagueifySeries Workflow

Systematically vague-ify an entire blog narrative series through the four-phase process.

---

## Inputs Required

| Parameter | Description | Example |
|-----------|-------------|---------|
| **series_directory** | Path to blog series | `/Users/zuul/Projects/tuonela-private/src/content/blog/adaptive-research/` |
| **series_name** | Series identifier | `adaptive-research` |
| **story_pattern** | File pattern to match | `adaptive-research-story-*.mdx` |

---

## Phase 1: Audit Stories

### Step 1: Create Working Directory

```bash
TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
WORK_DIR="${PAI_DIR}/scratchpad/vague-ify-${series_name}-${TIMESTAMP}"
mkdir -p ${WORK_DIR}/eic-reviews
```

### Step 2: Identify Stories

```bash
cd ${series_directory}
ls -1 ${story_pattern} | sort > ${WORK_DIR}/story-list.txt
```

### Step 3: Grep for Brittle Patterns

Run these greps to find brittle claims:

```bash
# Model names
rg -i "claude|gpt-?4|gemini|haiku|sonnet|opus|perplexity|grok" ${series_directory}/${story_pattern} > ${WORK_DIR}/model-names.txt

# Dollar amounts
rg '\$[0-9]+\.[0-9]+|\$[0-9]+' ${series_directory}/${story_pattern} > ${WORK_DIR}/dollar-amounts.txt

# Percentages (be careful - some legitimate uses exist)
rg '[0-9]+%' ${series_directory}/${story_pattern} > ${WORK_DIR}/percentages.txt

# Platform names (check context - some are legitimate references)
rg -i "twitter|linkedin|reddit|bluesky" ${series_directory}/${story_pattern} > ${WORK_DIR}/platform-names.txt

# Large numbers that might be metrics
rg '[0-9]{3,} (tokens|KB|MB|domains|sources|citations)' ${series_directory}/${story_pattern} > ${WORK_DIR}/metrics.txt
```

### Step 4: Generate Audit Report

Create `${WORK_DIR}/audit-report.md`:

```markdown
# Vague-ify Audit: [series_name]

**Date:** [current date]
**Stories:** [count] stories found
**Scope:** [series_directory]

## Brittle Claims Found

### Model Names
[Paste from model-names.txt - summarize count and common patterns]

### Dollar Amounts
[Paste from dollar-amounts.txt - list all instances]

### Percentages
[Paste from percentages.txt - identify which are claims vs legitimate numbers]

### Platform Names
[Paste from platform-names.txt - identify which are claims vs legitimate references]

### Precise Metrics
[Paste from metrics.txt - identify which invite fact-checking]

## Recommended Approach

- **Scope:** [X] stories need cleanup
- **Estimated effort:** [Y] transformations across all stories
- **Risk level:** [Low/Medium/High] - depends on how central specific claims are to narratives
- **Proceed with vague-ifying:** [Yes/No with explanation]
```

### Step 5: Present to User

Show audit report and get approval to proceed.

---

## Phase 2: Apply Transformations

### Step 6: Launch Parallel Author Agents

**For each story** (or in batches of 3-5 for large series):

```typescript
// Pseudo-code for agent dispatch
for each story in story_list:
    Task({
        subagent_type: "engineer",
        model: "sonnet",
        description: `Vague-ify ${story_name}`,
        prompt: `
You are an expert author agent specializing in blog narrative cleanup.

## CRITICAL: Load Required Skills First

**BEFORE starting work, you MUST:**

1. **Read NarrativeWriting skill** for Wodehouse style preservation:
   \`/Users/zuul/Projects/PAI/.claude/skills/NarrativeWriting/SKILL.md\`

2. **Read ReviewAIPatterns skill** for AI tell detection:
   \`/Users/zuul/Projects/PAI/.claude/skills/ReviewAIPatterns/SKILL.md\`

These skills are MANDATORY - they ensure you maintain narrative voice and don't introduce AI tells during cleanup.

---

## Your Task

Clean up brittle claims in this story while preserving narrative strength.

**Story to clean:** ${story_path}

## Transformation Guidelines

Follow the VagueifyStories skill transformation patterns:

1. **Model names** → functional descriptors
   - "Claude" → "the analyzer" / "primary analyzer"
   - "GPT-4" → "depth-focused model" / "high-capability model"
   - "Gemini" → "the specialist" / "citation handler"
   - "Haiku/Sonnet/Opus" → "lightweight model" / "more capable model"

2. **Dollar amounts** → comparative language
   - "$0.60" → "significantly cheaper"
   - "$3.50" → "more expensive"
   - Cost comparisons → relative cost (cheaper/more expensive, dropped significantly)

3. **Percentages** → qualitative descriptors
   - "88%" → "high" / "excellent"
   - "58%" → "majority" / "over half"
   - "19%" → "less than one in five" / "abysmal"

4. **Platform names** → generic categories (ONLY when they're claims, NOT legitimate references)
   - "Twitter/X" → "social media" / "microblogging platforms"
   - "LinkedIn" → "professional networks"
   - "Reddit" → "discussion forums"

5. **Precise metrics** → magnitude descriptors
   - "352KB" → "hundreds of kilobytes"
   - "30,000 tokens" → "massive token budget" / "enough to choke context"
   - "226 domains" → "hundreds of domains"

## Critical Constraints

**PRESERVE:**
- Wodehouse narrative voice
- Character dynamics (Petteri/Marvin)
- Witty dialogue
- Technical insights and architectural reasoning
- Narrative arc and story structure
- Legitimate technical terms (HMAC-SHA256, w400, etc.)
- Inline code references in backticks

**AVOID:**
- Breaking narrative flow
- Introducing hedging language ("perhaps", "it's worth noting")
- Creating new AI tells
- Over-vague-ifying (keep role descriptors specific enough to understand)
- Inconsistent transformations (if you call it "the analyzer" once, use that throughout)

## Special Case: Narrative-Essential Numbers

Some specific numbers are THE POINT of the story. Examples:
- "88% quality / 0% coverage" in platform coverage story - KEEP these, they're the insight
- "6-1-1 allocation" that's wrong and gets fixed - KEEP for narrative

If a number is central to the story's lesson, ASK before removing it.

## MANDATORY Verification Step

**AFTER making all transformations, you MUST:**

1. **Use ReviewAIPatterns skill** to check your edited story for AI tells:
   - **Zero em-dashes** (humans don't use them - replace with ellipsis for pauses, or rewrite)
   - No hedging language ("perhaps", "it's worth noting")
   - No list structures disguised as prose
   - Varied paragraph lengths (not all the same)
   - No summary paragraphs ("In conclusion", "To summarize")

2. **If AI tells found:** Fix them BEFORE submitting your work
   - Em-dashes → ellipsis for continuity (e.g., "building... six decisions...") or rewrite
   - Use colons, commas, periods, or parentheses instead of em-dashes

3. **Read edited sections aloud** (mentally) - if it sounds like AI wrote it, revise

**The cleanup should REDUCE AI tells, not introduce new ones.**

## Output

Edit the story file in place. Report:
1. What transformations you made and why
2. ReviewAIPatterns verification results (CLEAN or issues found + fixed)
        `
    })
```

### Step 7: Collect Transformation Logs

Each agent reports changes made. Consolidate into `${WORK_DIR}/transformation-log.md`.

---

## Phase 3: EIC Review

### Step 8: Launch Parallel EIC Agents

**For each story:**

```typescript
Task({
    subagent_type: "engineer",
    model: "sonnet",
    description: `EIC review ${story_name}`,
    prompt: `
You are an Editor-in-Chief reviewing a vague-ified blog narrative.

## Your Task

Review this story and assess whether narrative strength was maintained after vague-ifying cleanup.

**Story to review:** ${story_path}

## Review Dimensions

Rate each dimension 0-10 and provide specific feedback:

### 1. Narrative Coherence (8-10 target)
- Story arc intact?
- Natural flow maintained?
- Beginning/middle/end clear?
- Transitions smooth?

### 2. Wodehouse Voice (8-10 target)
- Character dynamics preserved (Petteri/Marvin)?
- Witty dialogue maintained?
- Self-deprecating humor intact?
- Conversational tone natural?

### 3. Vague Language Quality (8-10 target)
- Generic references feel natural (not evasive)?
- Functional descriptors clear enough to understand?
- No over-vague-ifying?
- Transformations consistent throughout?

### 4. Technical Credibility (8-10 target)
- Authority maintained despite genericization?
- Sound reasoning clear?
- Process description concrete?
- Architectural insights preserved?

### 5. AI Tells (8-10 target = minimal AI tells)
- **Zero em-dashes?** (humans don't use them - should be ellipsis or rewritten)
- No hedging language ("perhaps", "it's worth noting")?
- No list structures disguised as prose?
- Paragraph lengths varied (not all the same)?
- No summary paragraphs ("In conclusion", "To summarize")?

## Verdict

Choose one:

**EXCELLENT (9+ average)**: Publish as-is, no changes needed

**NEEDS MINOR REVISION (7-8.9 average)**: 10-20 minutes of cleanup needed
- List specific issues with line numbers
- Provide suggested fixes

**NEEDS MAJOR REVISION (<7 average)**: Significant rework needed
- Explain what failed
- Recommend approach to fix

## Output Format

Write your review to:
${WORK_DIR}/eic-reviews/${story_name}-review.md

Use this structure:

\`\`\`markdown
# EIC Review: ${story_name}

**Date:** ${current_date}
**Reviewer:** EIC Agent
**Verdict:** [EXCELLENT | NEEDS MINOR REVISION | NEEDS MAJOR REVISION]

## Dimension Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Narrative Coherence | X/10 | ... |
| Wodehouse Voice | X/10 | ... |
| Vague Language Quality | X/10 | ... |
| Technical Credibility | X/10 | ... |
| AI Tells (cleanliness) | X/10 | ... |
| **Average** | **X.X/10** | |

## Issues Found

[If NEEDS MINOR/MAJOR REVISION:]

### Issue 1: [Category]
**Location:** Line XXX
**Problem:** [Specific issue]
**Fix:** [Suggested correction]

### Issue 2: ...

## Overall Assessment

[2-3 sentences on story quality and publication readiness]
\`\`\`
    `
})
```

### Step 9: Collect and Summarize EIC Feedback

Consolidate all EIC reviews into `${WORK_DIR}/eic-summary.md`:

```markdown
# EIC Review Summary: [series_name]

**Stories Reviewed:** [count]
**Publication-Ready:** [count with EXCELLENT verdict]
**Need Minor Fixes:** [count with MINOR REVISION verdict]
**Need Major Work:** [count with MAJOR REVISION verdict]

## Stories by Verdict

### ✅ Publish As-Is ([count] stories)
- Story 01: [title]
- Story 02: [title]
...

### 🟡 Minor Fixes Needed ([count] stories)
- Story 05: [title] - [brief issue summary]
- Story 07: [title] - [brief issue summary]
...

### 🔴 Major Revision Needed ([count] stories)
- Story XX: [title] - [what failed]
...

## Next Steps

[List stories needing fixes with specific actions]
```

Present summary to user.

---

## Phase 4: Apply Fixes

### Step 10: Launch Fix Agents

**For each story needing minor fixes:**

```typescript
Task({
    subagent_type: "engineer",
    model: "sonnet",
    description: `Fix ${story_name} per EIC`,
    prompt: `
Apply EIC-identified fixes to this story.

**Story:** ${story_path}
**EIC Review:** ${WORK_DIR}/eic-reviews/${story_name}-review.md

## Your Task

Read the EIC review and apply ALL suggested fixes:

${paste EIC issues section}

## Common Fix Types

1. **Story link corrections** - Verify links point to correct story files
2. **Em-dash elimination** - Replace with ellipsis or rewrite (em-dashes should NOT appear in human text)
3. **Minor style improvements** - Expand terse phrases, smooth awkward constructions
4. **Math error corrections** - Fix numerical inconsistencies
5. **Timeline clarifications** - Make temporal references clearer

## Critical

- Apply fixes exactly as suggested by EIC
- Don't introduce new issues
- Maintain Wodehouse voice
- Test any changed links

## Output

Report what you fixed and confirm all issues addressed.
    `
})
```

### Step 11: Verify Fixes Applied

Read a sample of fixed stories to confirm:
- [ ] All EIC issues addressed
- [ ] No new problems introduced
- [ ] Links work correctly
- [ ] Narrative flow maintained

---

## Completion

### Step 12: Final Summary

Create `${WORK_DIR}/summary.md`:

```markdown
# Vague-ify Complete: [series_name]

**Date:** [current date]
**Stories Processed:** [count]
**Status:** Publication-ready

## Work Completed

### Phase 1: Audit
- [X] stories scanned
- [Y] brittle claims identified
- [Z] transformations planned

### Phase 2: Transformations
- Model names: [count] → generic references
- Dollar amounts: [count] → comparative language
- Percentages: [count] → qualitative descriptors
- Platform names: [count] → generic categories
- Metrics: [count] → magnitude descriptors

### Phase 3: EIC Reviews
- [X] stories rated EXCELLENT (publish as-is)
- [Y] stories needed minor fixes
- [Z] stories needed major work

### Phase 4: Fixes Applied
- [List of stories fixed]
- All fixes verified

## Publication Status

✅ All [count] stories publication-ready

## Key Learnings

[Any patterns discovered, pitfalls avoided, recommendations for next series]
```

### Step 13: Archive Summary (Optional)

If the work contains valuable insights:

```bash
cp ${WORK_DIR}/summary.md \
   ${PAI_DIR}/history/editorial/$(date +%Y-%m)/$(date +%Y-%m-%d-%H%M%S)_vague-ify-${series_name}-summary.md
```

Most vague-ifying work can stay in scratchpad and be cleaned up later.

---

## Success Criteria

Series vague-ifying is complete when:

- [ ] All stories have zero vendor-specific claims
- [ ] All EIC reviews rate stories 8+ (EXCELLENT or minor fixes applied)
- [ ] Narrative strength preserved (Wodehouse voice intact)
- [ ] Technical credibility maintained (sound reasoning, not specific claims)
- [ ] Transformations consistent across series
- [ ] All story links verified working
- [ ] Series publication-ready

**The vague-ified series should be MORE credible than the original because credibility comes from reasoning and process, not unverifiable specifics.**
