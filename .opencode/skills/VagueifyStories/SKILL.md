---
name: VagueifyStories
description: Systematically remove unverifiable claims from blog narrative series while preserving narrative strength. USE WHEN user wants to vague-ify stories, remove brittle claims, clean up series for publication, OR mentions removing model names, dollar amounts, unverifiable metrics from narratives.
---
# VagueifyStories

Systematically transform blog narrative series to remove unverifiable claims (model names, dollar amounts, specific metrics) while preserving narrative strength and technical credibility.

## Workflow Routing

**When executing a workflow, call the notification script via Bash:**

```bash
${PAI_DIR}/tools/skill-workflow-notification WorkflowName VagueifyStories
```

| Workflow | Trigger | File |
|----------|---------|------|
| **VagueifySeries** | "vague-ify this series", "clean up brittle claims" | `Workflows/VagueifySeries.md` |
| **AuditStories** | "audit stories for claims", "find brittle claims" | `Workflows/AuditStories.md` |

---

## Examples

**Example 1: Vague-ify an entire blog series**
```
User: "Vague-ify the tuonela-platform series"
→ Invokes VagueifySeries workflow
→ Audits all stories for brittle claims (model names, costs, metrics)
→ Launches parallel author agents to apply transformations
→ Launches parallel EIC agents to verify narrative strength maintained
→ Applies minor fixes from EIC feedback
→ Returns publication-ready series
```

**Example 2: Audit a series before cleanup**
```
User: "Audit the adaptive-research series for unverifiable claims"
→ Invokes AuditStories workflow
→ Scans all stories for brittle patterns
→ Reports findings: model names, dollar amounts, percentages, platform names
→ Recommends transformation approach
```

**Example 3: Single story cleanup**
```
User: "Remove vendor claims from story-04"
→ Invokes VagueifySeries workflow with single story
→ Transforms specific claims to generic references
→ EIC review confirms narrative strength
→ Returns cleaned story
```

---

## The Vague-ifying Pattern

### What We Remove (Brittle Claims)

These claims invite fact-checking and become outdated quickly:

| Brittle Claim | Why It's Brittle | Example |
|---------------|------------------|---------|
| **Model names** | Vendor-specific, changes frequently | "Claude Haiku", "GPT-4", "Gemini Pro" |
| **Dollar amounts** | Specific costs become outdated | "$0.60 per million tokens", "$3.50" |
| **Exact percentages** | Unverifiable without source logs | "88% quality", "58% valid", "19% utilization" |
| **Platform names** | Services rebrand, change access | "Twitter", "X", "LinkedIn API" |
| **Precise metrics** | Hard to verify months later | "352KB loaded", "30,000 tokens", "226 domains" |

### What We Replace With (Durable References)

These maintain narrative strength without verification risk:

| Transformation | Pattern | Example |
|----------------|---------|---------|
| **Model → Role** | Vendor name → functional descriptor | "Claude" → "the analyzer", "GPT-4" → "depth-focused model" |
| **Cost → Comparison** | Dollar amount → relative cost | "$0.60" → "significantly cheaper", "$3.50" → "more expensive" |
| **Percentage → Qualitative** | Number → descriptor | "88%" → "high quality", "58%" → "majority", "19%" → "abysmal" |
| **Platform → Category** | Brand name → generic type | "Twitter/X" → "social media", "LinkedIn" → "professional networks" |
| **Metric → Magnitude** | Exact number → scale descriptor | "352KB" → "hundreds of kilobytes", "30K tokens" → "massive token budget" |

### Transformation Examples

**Model Names:**
```
BEFORE: "Claude generates perspectives, GPT-4 handles synthesis, Gemini does citations"
AFTER: "The analyzer generates perspectives, a depth-focused model handles synthesis, another handles citations"

BEFORE: "I switched from Haiku to Sonnet"
AFTER: "I switched from a lightweight model to a more capable one"
```

**Dollar Amounts:**
```
BEFORE: "Cost dropped from $3.50 to $0.60 per million tokens"
AFTER: "Cost dropped significantly, becoming much more viable for production use"

BEFORE: "At $2 per query, this was expensive"
AFTER: "At that cost, this was expensive"
```

**Percentages:**
```
BEFORE: "Quality score: 88%. Citation validity: 56%"
AFTER: "Quality score: high. Citation validity: barely half"

BEFORE: "19% of citations were actually used"
AFTER: "Less than one in five citations were actually used"

BEFORE: "Improved from 34% to 58%"
AFTER: "Improved significantly, though still not ideal"
```

**Platform Names:**
```
BEFORE: "Twitter and LinkedIn discussions, X posts, Reddit threads"
AFTER: "Social media discussions, professional networks, forum threads"

BEFORE: "The LinkedIn scraper hit rate limits"
AFTER: "The professional network scraper hit rate limits"
```

**Precise Metrics:**
```
BEFORE: "352KB loaded into context, 30,000 tokens consumed"
AFTER: "Hundreds of kilobytes loaded, enough tokens to choke context"

BEFORE: "226 domains across 304 sources"
AFTER: "Hundreds of domains across hundreds of sources"

BEFORE: "Took 116 seconds to complete"
AFTER: "Took nearly two minutes to complete"
```

---

## The Four-Phase Process

### Phase 1: Audit Stories

**Goal:** Identify all brittle claims across the series

**Process:**
1. Read all stories in the series
2. Grep for common brittle patterns:
   - Model names: Claude, GPT, Gemini, Haiku, Sonnet, Opus, Perplexity, Grok
   - Dollar signs: `$`
   - Percentages: `%`
   - Platform names: Twitter, X, LinkedIn, Reddit (check for legitimate usage vs claims)
   - Large numbers: tokens, KB, domains, sources
3. Document findings in scratchpad
4. Present summary to user with recommended approach

**Output:** Audit report listing all brittle claims found

### Phase 2: Apply Transformations

**Goal:** Systematically replace brittle claims with durable references

**Process:**
1. Launch parallel author agents (one per story or in batches)
2. Each agent receives:
   - The story to clean
   - Transformation pattern guidelines
   - NarrativeWriting skill context (Wodehouse style)
   - Instruction to maintain narrative flow
3. Agents apply transformations:
   - Model names → functional descriptors
   - Costs → comparative language
   - Percentages → qualitative descriptors
   - Platform names → generic categories (where they're claims, not legitimate references)
   - Metrics → magnitude descriptors
4. Agents preserve:
   - Wodehouse voice
   - Character dynamics
   - Technical insights
   - Narrative arc
   - Legitimate technical terms (inline code like `w400`, `HMAC-SHA256`)

**Output:** Cleaned stories with transformations applied

### Phase 3: EIC Review

**Goal:** Verify narrative strength maintained after cleanup

**Process:**
1. Launch parallel EIC (Editor-in-Chief) agents (one per story)
2. Each EIC reviews on multiple dimensions:
   - **Narrative Coherence** (8-10): Story arc intact, flows naturally
   - **Wodehouse Voice** (8-10): Character dynamics preserved, witty dialogue maintained
   - **Vague Language Quality** (8-10): Generic references feel natural, not evasive
   - **Technical Credibility** (8-10): Authority maintained despite genericization
   - **AI Tells** (8-10): Minimal AI patterns, strong human voice
3. Each EIC provides verdict:
   - **EXCELLENT**: Publish as-is (score 9+)
   - **NEEDS MINOR REVISION**: 10-20 minutes of fixes (score 7-8.9)
   - **NEEDS MAJOR REVISION**: Significant rework needed (score <7)
4. EICs document specific issues and suggested fixes

**Output:** Review reports with verdicts and fix recommendations

### Phase 4: Apply Fixes

**Goal:** Address minor issues identified by EICs

**Process:**
1. Collect all EIC feedback
2. Identify stories needing fixes (typically 20-40% need minor edits)
3. Launch parallel author agents for fixes:
   - Story link corrections
   - Em-dash elimination (replace with ellipsis or rewrite)
   - Minor style improvements
   - Math error corrections
   - Timeline clarifications
4. Verify fixes applied correctly

**Output:** Publication-ready series

---

## Integration with Other Skills

### NarrativeWriting Skill (MANDATORY)

**Author agents MUST read the NarrativeWriting skill BEFORE starting cleanup:**
```
/Users/zuul/Projects/PAI/.claude/skills/NarrativeWriting/SKILL.md
```

Vague-ifying must preserve Wodehouse narrative style:
- Character voice (Petteri/Marvin dynamics)
- Witty dialogue carrying technical content
- Self-deprecating humor
- Natural conversational flow
- Cold coffee motifs and physical grounding

**Why mandatory:** Without this context, agents will break narrative voice during transformations.

### ReviewAIPatterns Skill (MANDATORY)

**Author agents MUST use ReviewAIPatterns skill AFTER completing transformations:**
```
/Users/zuul/Projects/PAI/.claude/skills/ReviewAIPatterns/SKILL.md
```

Verify the edited story has no AI tells:
- **Zero em-dashes** (humans don't use them - use ellipsis for pauses/continuity, or rewrite)
- No hedging language ("perhaps", "it's worth noting")
- No list structures disguised as prose
- Varied paragraph lengths (not all the same)
- No summary paragraphs ("In conclusion", "To summarize")

**Em-dash alternatives:**
- Pause/continuity: Use ellipsis (e.g., "After a week of building... six architectural decisions...")
- Separation: Use colon, comma, or period
- Emphasis: Rewrite the sentence for clarity

**Why mandatory:** Vague-ifying should REDUCE AI tells, not introduce new ones. Agents must verify their edits sound human-written.

**Both skills are non-negotiable** - they ensure cleanup maintains narrative quality while removing brittle claims.

---

## Common Pitfalls

### Pitfall 1: Over-Vague-ifying

**Problem:** Removing ALL specifics makes stories feel vague and evasive

**Example:**
```
TOO VAGUE: "The system used a model to do the thing"
GOOD: "The lightweight model handled initial analysis"
```

**Rule:** Keep role-based descriptors specific enough to understand function

### Pitfall 2: Breaking Technical Legitimacy

**Problem:** Removing legitimate technical terms that aren't vendor claims

**Example:**
```
WRONG: Removing "HMAC-SHA256" → "the algorithm"
RIGHT: Keep "HMAC-SHA256" (it's a technical standard, not a vendor claim)

WRONG: Removing "w400" → "the size"
RIGHT: Keep "w400" (it's a legitimate CSS breakpoint reference)
```

**Rule:** Only remove vendor-specific claims, not technical standards or inline code

### Pitfall 3: Inconsistent Transformation

**Problem:** Same claim transformed differently across stories

**Example:**
```
INCONSISTENT:
Story 1: "Claude" → "the analyzer"
Story 3: "Claude" → "primary system"
Story 5: "Claude" → "the LLM"

CONSISTENT:
All stories: "Claude" → "the analyzer" OR "primary analyzer"
```

**Rule:** Use consistent transformations across a series for the same entity

### Pitfall 4: Introducing New AI Tells

**Problem:** Transformation creates hedging or awkward phrasing

**Example:**
```
AI TELL: "The model, which was perhaps more capable, handled the task"
CLEAN: "The more capable model handled the task"

AI TELL: "It's worth noting that costs dropped significantly"
CLEAN: "Costs dropped significantly"
```

**Rule:** Transformations should simplify and strengthen, not hedge

### Pitfall 5: Ignoring Narrative Context

**Problem:** Mechanical find-replace without understanding story context

**Example:**
```
WRONG: "88% quality" → "high quality" in a story about discovering quality metrics are misleading
RIGHT: Keep "88%" because it's THE POINT of the story (quality metric blind to coverage gaps)
```

**Rule:** Some specific numbers are narratively essential. Keep them when they drive the story.

---

## Success Criteria

A vague-ified series is successful when:

1. **Zero vendor-specific claims** that could be fact-checked or become outdated
2. **Narrative strength maintained** as verified by independent EIC reviews (scores 8+)
3. **Technical credibility preserved** through sound reasoning and process description
4. **Wodehouse voice intact** with character dynamics and witty dialogue
5. **AI tells minimized** (em-dashes, hedging, list structures eliminated)
6. **Consistent transformations** across all stories in the series
7. **Publication-ready** without requiring additional cleanup

**The test:** A reader should find the stories credible and engaging WITHOUT being able to identify specific vendors, costs, or metrics that could be verified or become outdated.

---

## File Organization

### Working Files (Scratchpad)

```
${PAI_DIR}/scratchpad/vague-ify-[series-name]/
├── audit-report.md              # Phase 1: Brittle claims inventory
├── transformation-log.md        # Phase 2: Changes made per story
├── eic-reviews/                 # Phase 3: Individual story reviews
│   ├── story-01-review.md
│   ├── story-02-review.md
│   └── ...
└── summary.md                   # Phase 4: Final summary and status
```

### Permanent Archive (History)

```
${PAI_DIR}/history/editorial/YYYY-MM/
└── YYYY-MM-DD-HHMMSS_vague-ify-[series-name]-summary.md
```

**Only archive the summary** - working files can be deleted after completion.

---

## Quick Reference

### Transformation Cheat Sheet

| Find | Replace With |
|------|--------------|
| Claude/GPT/Gemini/model names | the analyzer, lightweight model, depth-focused model, primary system |
| $X.XX costs | significantly cheaper/more expensive, much cheaper, cost dropped significantly |
| XX% percentages | high/low/majority/minority, most/few, around half, significantly reduced |
| Twitter/X/LinkedIn | social media, professional networks, microblogging platforms |
| XXX KB/tokens/numbers | hundreds of kilobytes, massive token budget, enough to choke context |

### Phase Checklist

- [ ] **Phase 1**: Audit complete, brittle claims documented
- [ ] **Phase 2**: Transformations applied to all stories
- [ ] **Phase 3**: EIC reviews collected, all rated 7+
- [ ] **Phase 4**: Minor fixes applied, links verified
- [ ] **Verification**: Sample stories read aloud, sound human
- [ ] **Publication**: Series ready to ship

---

**This skill ensures blog narratives maintain credibility through sound reasoning and concrete process, not through claiming specific numbers that can't be verified months later.**
