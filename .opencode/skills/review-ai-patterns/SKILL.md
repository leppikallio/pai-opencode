---
name: review-ai-patterns
description: Detect AI writing patterns in text and produce actionable review reports. USE WHEN reviewing stories for AI tells, running AI detox pass, OR preparing text for human-quality publication.
---
# ReviewAIPatterns

## Source

- Wikipedia: [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)

Review text for AI writing patterns and produce structured reports that an author agent can act on. Based on Wikipedia's "Signs of AI writing" documentation.

## Output Format

Every review MUST produce this exact structure:

```markdown
## AI Detection Report: [filename]

**Word Count:** [X words]
**Issues Found:** [N]
**Verdict:** [CLEAN | NEEDS REVISION | HEAVY REVISION NEEDED]

### Issues

1. **Pattern:** [pattern category]
   **Location:** [paragraph/line reference]
   **Found:** "[exact quote]"
   **Fix:** [specific rewrite suggestion]

[repeat for each issue]

### Summary
[1-2 sentences on overall AI-ness of the text]
```

**Verdict thresholds:**
- CLEAN: 0-1 minor issues per 1000 words
- NEEDS REVISION: 2-5 issues per 1000 words
- HEAVY REVISION NEEDED: 6+ issues per 1000 words, or any "dead giveaway" patterns

---

## Pattern Categories

### 1. VOCABULARY - Overused AI Words

**Dead giveaways** (flag every instance):
- delve, delves, delving
- tapestry (metaphorical use)
- intricacies, intricate
- multifaceted
- holistic
- paradigm (outside academic context)
- synergy, synergies
- leverage (as verb for non-financial contexts)

**High frequency AI words** (flag if 2+ per 1000 words):
- underscore, underscores
- pivotal
- foster, fostering
- garner, garnered
- crucial
- enhance, enhancing
- landscape (metaphorical: "the AI landscape")
- testament ("stands as a testament")
- showcase, showcasing
- comprehensive
- robust
- nuanced
- noteworthy
- remarkable, remarkably
- notable, notably
- particularly
- specifically
- essentially
- fundamentally
- ultimately

**AI phrase patterns** (flag every instance):
- "It's worth noting that..."
- "It's important to note that..."
- "One might argue..."
- "serves as a testament to"
- "stands as a testament to"
- "plays a vital/crucial/pivotal role"
- "not only X but also Y" (parallel construction)
- "ensuring that..."
- "reflecting the..."
- "a testament to..."
- "In conclusion" / "To summarize" / "In summary"

---

### 2. STRUCTURE - Mechanical Patterns

**Rule of three** (flag if overused):
- Lists of exactly three items repeatedly
- "X, Y, and Z" constructions appearing multiple times
- Three parallel sentences in a row

**Negative parallelism** (flag every instance):
- "Not only X but also Y"
- "Not just A but B"
- "Neither X nor Y, but rather Z"

**Elegant variation** (flag when awkward):
- Avoiding word repetition by using synonyms unnaturally
- "The system... The platform... The solution..." referring to same thing
- Thesaurus-driven synonym chains

**Even paragraph lengths**:
- Flag if most paragraphs are within 10% of the same length
- Human writing has messy, varied paragraph lengths

**List structures in prose**:
- "There are three main reasons: first... second... third..."
- "Several factors contribute: (1)... (2)... (3)..."
- Enumerated points disguised as flowing text

---

### 3. STYLE - Tone and Voice

**Em-dash overuse**:
- More than 2 em-dashes per 500 words = flag
- "The code—surprisingly—worked" pattern

**Hedging language** (flag every instance):
- "perhaps"
- "it could be argued"
- "one might say"
- "it's worth noting"
- "it bears mentioning"
- "arguably"

**Promotional/hagiographic tone**:
- Excessive praise without criticism
- "groundbreaking," "revolutionary," "transformative"
- Lack of any negative assessment
- Everything described as successful/brilliant

**Superficial analysis**:
- Broad claims without specific evidence
- "The impact was significant" without saying what impact
- Symbolic interpretations without textual support

**Excessive qualifiers**:
- "very," "really," "extremely," "incredibly"
- Stacking adjectives: "a truly remarkable and groundbreaking achievement"

---

### 4. TECHNICAL TELLS

**NOTE:** These stories are markdown files with legitimate technical content. Inline code with backticks (like `w400` or `HMAC-SHA256`) is ALLOWED per NarrativeWriting skill rules. Only flag actual problems:

**Placeholder text** (flag every instance):
- "[Insert X here]"
- "As of my knowledge cutoff..."
- "I don't have access to real-time information"
- References to being an AI or language model
- "TODO" or "TBD" left in final text

**AI self-reference artifacts**:
- "As an AI..." or "As a language model..."
- "I cannot..." (capability disclaimers)
- "I don't have personal experience..."

**Formatting inconsistencies**:
- Mixed quote styles (curly and straight in same document)
- Inconsistent capitalization patterns
- Broken markdown (unclosed backticks, malformed links)

**NOT issues in these files:**
- Inline code with backticks (legitimate for technical terms)
- Markdown formatting (these ARE .md files)
- Code references in dialogue (part of the narrative style)

---

### 5. CONTENT PATTERNS

**Undue weight on symbolism/legacy**:
- Excessive discussion of "legacy" or "lasting impact"
- Symbolic interpretations without evidence
- "What this represents..." without concrete details

**Missing critical perspective**:
- No mention of failures, limitations, or criticism
- Everything framed positively
- Hagiographic treatment of subjects

**Vague temporal references**:
- "In recent years..."
- "Throughout history..."
- "Since time immemorial..."
- No specific dates or timeframes

**Knowledge cutoff artifacts**:
- Information that stopped at a specific date
- Outdated statistics presented as current
- Missing recent developments that should be known

---

## Review Process

1. **First pass:** Scan for dead giveaway vocabulary
2. **Second pass:** Check structural patterns (lists, parallelism, paragraph lengths)
3. **Third pass:** Assess tone and hedging language
4. **Fourth pass:** Look for technical tells and formatting issues
5. **Compile report:** Document each issue with location and fix suggestion

---

## Examples

### Example 1: Vocabulary Issue

**Found in text:**
> "The adaptive research system delves into the intricacies of multi-agent coordination, showcasing a comprehensive approach that fosters innovation."

**Report entry:**
```
1. **Pattern:** Vocabulary - Dead giveaways
   **Location:** Paragraph 1, sentence 1
   **Found:** "delves into the intricacies"
   **Fix:** "examines" or "explores"

2. **Pattern:** Vocabulary - High frequency AI words
   **Location:** Paragraph 1, sentence 1
   **Found:** "showcasing a comprehensive approach that fosters"
   **Fix:** "demonstrating an approach that encourages" or rewrite entirely
```

### Example 2: Structural Issue

**Found in text:**
> "The system offers three key benefits: first, improved accuracy; second, reduced latency; third, lower costs. Not only does it enhance performance, but it also reduces complexity."

**Report entry:**
```
1. **Pattern:** Structure - List in prose
   **Location:** Paragraph 4
   **Found:** "three key benefits: first... second... third..."
   **Fix:** Integrate naturally: "The accuracy improved, latency dropped, and costs fell—though not equally."

2. **Pattern:** Structure - Negative parallelism
   **Location:** Paragraph 4, sentence 2
   **Found:** "Not only does it enhance... but it also..."
   **Fix:** "It runs faster and the code is simpler."
```

### Example 3: Style Issue

**Found in text:**
> "It's worth noting that the implementation—surprisingly—exceeded expectations. The results were, perhaps, more remarkable than anticipated."

**Report entry:**
```
1. **Pattern:** Style - Hedging language
   **Location:** Paragraph 6
   **Found:** "It's worth noting that"
   **Fix:** Delete phrase, start with "The implementation"

2. **Pattern:** Style - Em-dash overuse
   **Location:** Paragraph 6
   **Found:** "implementation—surprisingly—exceeded"
   **Fix:** "implementation surprised us by exceeding" or use commas

3. **Pattern:** Style - Hedging language
   **Location:** Paragraph 6
   **Found:** "perhaps"
   **Fix:** Commit to the statement or delete it
```

---

## Integration with Author Agent

When handing report to author agent, include:

1. The full report (as formatted above)
2. The original text file path
3. Priority order: Fix dead giveaways first, then high-frequency issues, then stylistic polish

Author agent should:
1. Address each issue in order
2. Re-read the edited section aloud (mentally) to check flow
3. Avoid introducing new AI patterns while fixing old ones
4. Request re-review when done

---

## Completion Criteria

A text passes AI detection review when:
- Zero dead giveaway vocabulary
- Fewer than 2 high-frequency AI words per 1000 words
- No list structures disguised as prose
- Em-dash count ≤ 2 per 500 words
- No hedging phrases
- Varied paragraph lengths
- Natural, committed voice throughout

**A human should be unable to identify the text as AI-generated based on linguistic patterns alone.**
