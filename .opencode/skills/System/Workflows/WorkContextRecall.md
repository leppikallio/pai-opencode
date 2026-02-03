# WorkContextRecall Workflow

## Trigger
"we just worked on", "remember when we", "what did we do for X", "recall work on", "find previous work", "past implementation"

## Purpose
Search past work when the user asks about previous fixes, implementations, or decisions by querying MEMORY artifacts, session documents, and the PAISYSTEMUPDATES index.

## What It Does

Retrieves context from past work by searching:

1. **Session Documents** - Recent session transcripts and work logs
2. **MEMORY Work Items** - Structured work artifacts in MEMORY/WORK/
3. **Project Updates** - Changes documented in MEMORY/PAISYSTEMUPDATES/
4. **Learning Documents** - Captured learnings and patterns
5. **System Updates Index** - Using UpdateSearch.ts tool for indexed searches
6. **Git History** - Commit messages and diffs for technical details

## Execution Pattern

```typescript
// 1. Parse user query to extract keywords and context
// 2. Search PAISYSTEMUPDATES index using UpdateSearch.ts
// 3. Query MEMORY/WORK for relevant work sessions
// 4. Search MEMORY/WORK for related work items
// 5. Scan git history for matching commits
// 6. Aggregate and rank results by relevance
// 7. Present consolidated context to user
```

## Implementation Steps

### 1. Query Analysis

Parse the user's question to extract search parameters:

```typescript
function analyzeRecallQuery(query: string) {
  const patterns = {
    timeframe: [
      /(?:last|past|recent)\s+(week|month|day|year)/gi,
      /(?:yesterday|today|this week)/gi,
      /in\s+(\w+\s+\d{4})/gi  // "in January 2026"
    ],

    workType: [
      /bug.*?fix/gi,
      /feature|feat/gi,
      /refactor/gi,
      /implement/gi,
      /add|creat/gi
    ],

    technology: [
      /typescript|ts/gi,
      /hook|skill|workflow/gi,
      /mcp.*?server/gi,
      /algorithm/gi
    ],

    specific: [
      /file.*?name/gi,
      /function.*?called/gi,
      /how.*?did.*?we/gi
    ]
  };

  return {
    timeframe: extractTimeframe(query),
    workType: extractWorkType(query),
    keywords: extractKeywords(query),
    specificArtifacts: extractArtifacts(query)
  };
}
```

**Example queries:**
- "remember when we added the security hook?" → security + hook + added
- "what did we do for garrett-ai integration?" → garrett-ai + integration
- "how did we fix that typescript error last week?" → typescript + error + fix + last week

### 2. UpdateSearch Integration

Use the UpdateSearch.ts tool to query PAISYSTEMUPDATES index:

```bash
# Search system updates index
bun run "~/.config/opencode/skills/System/Tools/UpdateSearch.ts" "security hook"

# With time filter
bun run "~/.config/opencode/skills/System/Tools/UpdateSearch.ts" "<keyword>" --since "YYYY-MM-DD"

# Multiple keywords
bun run "~/.config/opencode/skills/System/Tools/UpdateSearch.ts" "typescript error fix"
```

Parse UpdateSearch results:

```typescript
interface UpdateSearchResult {
  file: string;
  title: string;
  date: string;
  excerpt: string;
  relevanceScore: number;
}

// UpdateSearch returns matching system updates
// Parse and rank by relevance
```

### 3. Session Document Search

Query MEMORY/WORK for relevant work sessions:

```bash
# Find sessions in timeframe
find "~/.config/opencode/MEMORY/WORK" -type f -name "META.yaml" -mtime -${days}

# Grep for keywords in session files
grep -l "security.*hook" "~/.config/opencode/MEMORY/WORK"/**/**/*.yaml 2>/dev/null || true

# Get session titles and dates
grep -R "title:" "~/.config/opencode/MEMORY/WORK"/**/META.yaml 2>/dev/null || true
```

Rank sessions by relevance:

```typescript
function rankSessionRelevance(session: SessionDoc, query: ParsedQuery): number {
  let score = 0;

  // Keyword matches in title
  score += countMatches(session.title, query.keywords) * 10;

  // Keyword matches in content
  score += countMatches(session.content, query.keywords) * 2;

  // Recency bonus
  const daysAgo = daysSince(session.date);
  score += Math.max(0, 30 - daysAgo);  // Up to 30 points for recent

  // Work type match
  if (session.type === query.workType) {
    score += 15;
  }

  return score;
}
```

### 4. MEMORY Work Item Search

Search structured work artifacts:

```bash
# Find work items
find "~/.config/opencode/MEMORY/WORK" -type f -name "*.yaml" -o -name "*.md"

# Search work item content
grep -r "${keyword}" "~/.config/opencode/MEMORY/WORK" --include="*.yaml" --include="*.md"

# Get work item metadata
cat "~/.config/opencode/MEMORY/WORK"/*/items/*.yaml | grep -E "title:|status:|date:"
```

Parse work items:

```typescript
interface WorkItem {
  id: string;
  title: string;
  status: string;
  date: string;
  description: string;
  artifacts: string[];
  relatedFiles: string[];
}

// Extract relevant work items
function searchWorkItems(keywords: string[]): WorkItem[] {
  const workItemFiles = glob("~/.config/opencode/MEMORY/WORK/**/items/*.yaml");

  return workItemFiles
    .map(file => parseWorkItem(file))
    .filter(item => matchesKeywords(item, keywords))
    .sort((a, b) => b.relevance - a.relevance);
}
```

### 5. Project Updates Search

Query project-specific updates:

```bash
# Search all project updates
find "~/.config/opencode/MEMORY/PAISYSTEMUPDATES" -type f -name "*.md" -maxdepth 4

# Find updates matching keywords
grep -r "${keyword}" "~/.config/opencode/MEMORY/PAISYSTEMUPDATES" --include="*.md"

# Get recent project activity
find "~/.config/opencode/MEMORY/PAISYSTEMUPDATES" -name "*.md" -mtime -30
```

Match projects to query:

```typescript
function searchProjectUpdates(query: ParsedQuery): ProjectUpdate[] {
  const projects = listProjects();
  const results = [];

  for (const project of projects) {
    const updates = glob(`${project.path}/Updates/*.md`);

    for (const updateFile of updates) {
      const content = readFile(updateFile);
      const relevance = calculateRelevance(content, query);

      if (relevance > THRESHOLD) {
        results.push({
          project: project.name,
          file: updateFile,
          date: extractDate(updateFile),
          excerpt: extractRelevantExcerpt(content, query),
          relevance
        });
      }
    }
  }

  return results.sort((a, b) => b.relevance - a.relevance);
}
```

### 6. Learning Documents Search

Search captured learnings:

```bash
# Search learning docs
grep -r "${keyword}" "~/.config/opencode/MEMORY/LEARNING" --include="*.md"

# List recent learnings
find "~/.config/opencode/MEMORY/LEARNING" -name "*.md" -mtime -30

# Search by tag/category
find "~/.config/opencode/MEMORY/LEARNING" -path "*/Security/*.md"
find "~/.config/opencode/MEMORY/LEARNING" -path "*/TypeScript/*.md"
```

Extract relevant learnings:

```typescript
function searchLearnings(keywords: string[]): Learning[] {
  const learningFiles = glob("~/.config/opencode/MEMORY/LEARNING/**/*.md");

  return learningFiles
    .map(file => {
      const content = readFile(file);
      const metadata = extractFrontmatter(content);

      return {
        file,
        title: metadata.title || extractTitle(content),
        tags: metadata.tags || [],
        date: metadata.date,
        category: getCategoryFromPath(file),
        excerpt: extractRelevantExcerpt(content, keywords),
        relevance: calculateRelevance(content, keywords)
      };
    })
    .filter(learning => learning.relevance > THRESHOLD)
    .sort((a, b) => b.relevance - a.relevance);
}
```

### 7. Git History Search

Search commit history for technical details:

```bash
# Search commit messages
git log --all --grep="${keyword}" --pretty=format:"%H|%s|%ai|%an"

# Search commit diffs
git log -S"${keyword}" --pretty=format:"%H|%s|%ai" --all

# Get file history
git log --follow --pretty=format:"%H|%s|%ai" -- "${file_path}"

# Search commit content
git log -p --all | grep -B5 -A5 "${keyword}"
```

Parse git results:

```typescript
interface CommitMatch {
  hash: string;
  subject: string;
  date: string;
  author: string;
  filesChanged: string[];
  relevantDiff?: string;
}

function searchGitHistory(keywords: string[]): CommitMatch[] {
  const results = [];

  // Search commit messages
  const messageMatches = execSync(
    `git log --all --grep="${keywords.join('\\|')}" --pretty=format:"%H|%s|%ai|%an"`
  );

  // Search code changes
  const codeMatches = execSync(
    `git log -S"${keywords[0]}" --pretty=format:"%H|%s|%ai"`
  );

  // Combine and deduplicate
  return combineAndRankGitResults(messageMatches, codeMatches);
}
```

### 8. Result Aggregation

Combine results from all sources:

```typescript
interface RecallResult {
  type: "session" | "work-item" | "project" | "learning" | "commit" | "update";
  title: string;
  date: string;
  file?: string;
  excerpt: string;
  relevance: number;
  metadata?: Record<string, any>;
}

function aggregateResults(
  sessions: SessionDoc[],
  workItems: WorkItem[],
  projectUpdates: ProjectUpdate[],
  learnings: Learning[],
  commits: CommitMatch[],
  systemUpdates: UpdateSearchResult[]
): RecallResult[] {

  const allResults = [
    ...sessions.map(s => toRecallResult(s, "session")),
    ...workItems.map(w => toRecallResult(w, "work-item")),
    ...projectUpdates.map(p => toRecallResult(p, "project")),
    ...learnings.map(l => toRecallResult(l, "learning")),
    ...commits.map(c => toRecallResult(c, "commit")),
    ...systemUpdates.map(u => toRecallResult(u, "update"))
  ];

  // Sort by relevance
  return allResults.sort((a, b) => b.relevance - a.relevance);
}
```

### 9. Context Synthesis

Synthesize results into coherent narrative:

```typescript
function synthesizeContext(results: RecallResult[], query: string): string {
  // Group by related work
  const relatedGroups = groupRelatedResults(results);

  // Create narrative sections
  const sections = [];

  // Timeline
  sections.push(createTimeline(results));

  // Key findings
  sections.push(createKeyFindings(results, query));

  // Technical details
  sections.push(createTechnicalDetails(results));

  // Related artifacts
  sections.push(createArtifactLinks(results));

  return sections.join("\n\n");
}
```

## Output Format

### Recall Summary

```markdown
# Work Context Recall: {query}
Search performed: {timestamp}

## Query Analysis
- Keywords: {extracted keywords}
- Timeframe: {detected timeframe}
- Work type: {detected type}

## Results Summary
Found {total} relevant artifacts:
- Sessions: {count}
- Work Items: {count}
- Project Updates: {count}
- Learnings: {count}
- Commits: {count}
- System Updates: {count}

## Timeline

Example timeline (timestamps illustrative):

**YYYY-MM-DD HH:MM** - Session: <session title>
- <what changed>
- Files: `~/.config/opencode/plugins/handlers/<file>.ts`
- Session: <link>

**YYYY-MM-DD HH:MM** - Learning: <learning title>
- <what was learned>
- Learning: <link>

**YYYY-MM-DD HH:MM** - Project Update: <update title>
- <what changed>
- Project: <link>

## Key Findings

### 1. Security Hook Implementation
**When:** YYYY-MM-DD HH:MM
**What:** Created security-validator hook to block dangerous commands
**How:**
- Hook intercepts Bash tool calls via PreToolUse event
- Pattern matching for destructive commands
- Exit code 2 signals blocked command

**Files Modified:**
- `~/.config/opencode/plugins/handlers/security-validator.ts` (created)
- Plugin configuration (runtime config file)

**Key Decisions:**
- Used exit code 2 for blocked commands (vs throwing errors)
- Regex patterns for reverse shell detection
- Allow-list for safe rm operations

**Related Commit:** <commit hash> - <commit subject>

### 2. Hook System Architecture
**When:** YYYY-MM-DD HH:MM - HH:MM
**What:** Refactored hook lifecycle and event system
**Learning:** Hooks execute in specific order, can modify context

**Session Context:**
- Discussed hook execution order
- Implemented parallel event capture
- Added observability integration

### 3. Testing & Validation
**When:** YYYY-MM-DD HH:MM
**What:** Tested security patterns with malicious command examples
**Results:** Successfully blocked all test cases

## Technical Details

### Implementation Pattern
```typescript
// Security validator hook
export default function securityValidator(context: HookContext) {
  const { toolName, parameters } = context;

  if (toolName === "Bash") {
    const dangerous = checkDangerousPatterns(parameters.command);
    if (dangerous) {
      process.exit(2);  // Block command
    }
  }
}
```

### Files Involved
- `~/.config/opencode/plugins/handlers/security-validator.ts` (updated)
- `~/.config/opencode/plugins/pai-unified.ts` (event capture)
- Plugin configuration (runtime config file)

### Tests Run
- ✅ Blocked `rm -rf /`
- ✅ Blocked reverse shell attempts
- ✅ Blocked data exfiltration
- ✅ Allowed safe commands

## Related Artifacts

### Session Documents
Example path: `~/.config/opencode/MEMORY/WORK/YYYY-MM/YYYYMMDDTHHMMSS_<slug>/`

### Learning Documents
Example path: `~/.config/opencode/MEMORY/LEARNING/<Category>/YYYYMMDDTHHMMSS_<slug>.md`

### Project Updates
Example path: `~/.config/opencode/MEMORY/PAISYSTEMUPDATES/YYYY/MM/YYYYMMDDTHHMMSS_<slug>.md`

### Commits
- <commit hash> - <subject>
- <commit hash> - <subject>

### System Updates
- Security Hook Implementation (found via UpdateSearch)
- Hook Lifecycle Documentation (found via UpdateSearch)

## Follow-up Questions

Based on this context, you might also be interested in:
1. How does the hook registration work in settings.json?
2. What other security patterns were considered?
3. How does this integrate with the observability system?

---
Search completed in 1.2s
Results ranked by relevance to query
```

### Console Output

```
## WorkContextRecall: "security hook"

Searching past work...

✓ UpdateSearch index (0.2s) - 3 results
✓ Session documents (0.3s) - 2 results
✓ Work items (0.1s) - 1 result
✓ Project updates (0.2s) - 1 result
✓ Learning docs (0.2s) - 1 result
✓ Git history (0.2s) - 2 commits

Found 10 relevant artifacts

## Most Relevant

**Session: <session title>** (YYYY-MM-DD HH:MM)
Created security-validator hook to block dangerous commands. Implemented
pattern matching for reverse shells, data exfiltration, and destructive ops.

**Learning: <learning title>** (YYYY-MM-DD HH:MM)
Learned exit code conventions for hooks. Exit 2 = blocked command allows
Claude Code to handle gracefully without throwing errors.

**Commit: <commit hash>** (YYYY-MM-DD HH:MM)
<commit subject>
Added pre-tool-use validation with dangerous pattern detection.

## Timeline
YYYY-MM-DD HH:MM - <milestone>
YYYY-MM-DD HH:MM - <milestone>
YYYY-MM-DD HH:MM - <milestone>
YYYY-MM-DD HH:MM - <milestone>

Full context report:
~/.config/opencode/MEMORY/STATE/integrity/{date}_work-recall_{slug}.md

Need more details on any of these?

Note: Example timestamps and paths above may not exist in your runtime.
```

## Advanced Features

### Smart Query Expansion

Expand user query with related terms:

```typescript
const queryExpansion = {
  "security": ["security", "safe", "validate", "block", "danger"],
  "hook": ["hook", "lifecycle", "event", "intercept"],
  "bug fix": ["fix", "bug", "error", "issue", "solve"],
  "feature": ["feat", "feature", "add", "implement", "create"]
};
```

### Related Work Detection

Find related work even if not directly matching:

```typescript
// If user searches for "security hook"
// Also find: sessions mentioning hooks, security patterns, validation

function findRelatedWork(primaryResults: RecallResult[]): RecallResult[] {
  const relatedKeywords = extractRelatedKeywords(primaryResults);
  return searchWithExpandedKeywords(relatedKeywords);
}
```

### Temporal Clustering

Group work by time proximity:

```typescript
// If multiple results within 2 hours, likely same work session
function clusterByTime(results: RecallResult[]): Cluster[] {
  const clusters = [];
  const sorted = results.sort((a, b) => a.date - b.date);

  let currentCluster = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const timeDiff = sorted[i].date - sorted[i-1].date;

    if (timeDiff < 2 * 60 * 60 * 1000) {  // 2 hours
      currentCluster.push(sorted[i]);
    } else {
      clusters.push(currentCluster);
      currentCluster = [sorted[i]];
    }
  }

  return clusters;
}
```

## Integration Points

- **UpdateSearch Tool**: Primary index search mechanism
- **DocumentRecent**: Creates artifacts that this workflow searches
- **PAI Skill**: Can use recall to load relevant context
- **Algorithm**: Can recall previous solutions to similar problems

## Example Usage

```
User: "remember when we added an MCP server?"

Jeremy: Searching past work for "MCP server"...

Found N relevant artifacts.

Most Relevant:

**Session: MCP Server Development** (YYYY-MM-DD)
Implemented an MCP server with voice support. Added functions:
<function_1>, <function_2>, <function_3>.

**Commit: <commit hash>** (YYYY-MM-DD HH:MM)
feat(mcp): <commit subject>

**Learning: MCP Function Naming** (YYYY-MM-DD)
Learned convention: mcp__{server-name}__{function-name}

Key technical details:
- Used Delphi.AI API for backend
- Implemented audio playback via macOS 'say' command
- Conversation state managed server-side

Files created:
- ~/.config/opencode/mcp/<server>/index.ts
- ~/.config/opencode/mcp/<server>/README.md

Want me to show you the implementation details or related work?
```

---

**Workflow Type**: Context Retrieval
**Execution Time**: ~1-2 seconds
**Destructive**: No (read-only)
**Requires User Input**: No (query comes from user message)
**Output**: Consolidated context summary + links to artifacts
