#!/usr/bin/env node

/**
 * Research Shell MCP Server
 *
 * Provides hard-enforced tool restrictions for research agents.
 * Each agent type gets ONLY its designated research tool - no bypass possible.
 *
 * SECURITY:
 * - Direct API calls (no shell interpretation)
 * - Strict input validation with allowlist-only characters
 * - Query length limits to prevent injection
 * - Evidence capture for audit trail
 *
 * This server runs via stdio transport and is spawned by the Agent SDK.
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { searchGemini as geminiSearch } from './clients/gemini.js';
import { grokSearch } from './clients/grok.js';
import { perplexitySearch } from './clients/perplexity.js';
import { loadConfig } from './config.js';
import { type RetryConfig, withRetry } from './retry.js';
import type { SearchResult } from './types.js';
import { renderGeminiWithGrounding } from './GeminiGrounding.js';

// ============================================================================
// Configuration
// ============================================================================

/** Maximum query length to prevent injection via extremely long inputs */
const MAX_QUERY_LENGTH = 4000;

/** Allowlist for query characters - reject anything outside this */
const SAFE_QUERY_PATTERN = /^[\w\s.,!?'"():;\-–—@#$%&*+=[\]{}|\\/<>~`^\n]+$/u;

/**
 * H7: Agent type from environment (set by container)
 * Used for server-side validation to prevent tool misuse
 */
const AGENT_TYPE = process.env.AGENT_TYPE || '';

/**
 * H7: Mapping of agent types to their allowed tools
 * Empty means all tools are allowed (for development/local use)
 */
const AGENT_ALLOWED_TOOLS: Record<string, string[]> = {
  'perplexity-researcher': ['perplexity_search'],
  'gemini-researcher': ['gemini_search'],
  'grok-researcher': ['grok_search'],
  // Perspective agent uses Gemini for ensemble classification of uncertain perspectives
  'perspective-agent': ['gemini_search'],
};

/**
 * Retry configuration for API calls
 *
 * Essential for handling transient failures from:
 * - Rate limiting (429)
 * - Network issues
 * - Temporary API unavailability
 */
const RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000, // 1 second
  maxDelayMs: 30000, // 30 seconds max
  backoffMultiplier: 2, // 1s -> 2s -> 4s
  jitter: true, // Prevent thundering herd
  debug: process.env.DEBUG === '1',
};

// ============================================================================
// Input Validation
// ============================================================================

interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

/**
 * Validate and sanitize a search query
 *
 * SECURITY: This is the primary defense against injection attacks.
 * We use allowlist validation (safe characters only) rather than blocklist.
 */
function validateQuery(query: string): ValidationResult {
  // Check length
  if (!query || query.length === 0) {
    return { valid: false, error: 'Query cannot be empty' };
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return {
      valid: false,
      error: `Query too long: ${query.length} > ${MAX_QUERY_LENGTH}`,
    };
  }

  // Trim whitespace
  const trimmed = query.trim();

  // Check for safe characters only
  if (!SAFE_QUERY_PATTERN.test(trimmed)) {
    // Find the problematic character for debugging
    const unsafeMatch = trimmed.match(
      /[^\w\s.,!?'"():;\-–—@#$%&*+=[\]{}|\\/<>~`^\n]/u,
    );
    return {
      valid: false,
      error: `Query contains unsafe characters: "${unsafeMatch?.[0]}"`,
    };
  }

  // Normalize whitespace
  const sanitized = trimmed.replace(/\s+/g, ' ');

  return { valid: true, sanitized };
}

// ============================================================================
// Evidence + Artifact Capture
// ============================================================================

type Provider = 'perplexity' | 'gemini' | 'grok';

interface EvidenceEntry {
  timestamp: string;
  callId: string;
  tool: string;
  provider: Provider;
  queryOriginal: string;
  querySanitized: string;
  success: boolean;
  durationMs?: number;
  outputLength?: number;
  citationCount?: number;
  contentSha256?: string;
  artifactJsonPath: string;
  artifactMdPath: string;
  /** Error message if success=false (captures final error after retries) */
  error?: string;
}

interface ArtifactRecord {
  schemaVersion: 1;
  timestamp: string;
  callId: string;
  tool: string;
  provider: Provider;
  queryOriginal: string;
  querySanitized: string;
  config: unknown;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  success: boolean;
  warning?: string;
  content?: string;
  citations?: string[];
  citationStyle?: 'ieee';
  webSearchQueries?: string[];
  groundingStatus?: 'ok' | 'missing' | 'partial' | 'offset_mismatch';
  resolvedReferences?: Array<{
    refNum: number;
    chunkIndex: number;
    redirectUrl: string;
    resolvedUrl: string;
    title?: string;
    domain?: string;
  }>;
  droppedReferences?: Array<{
    chunkIndex: number;
    redirectUrl: string;
    title?: string;
    domain?: string;
    lastStatus?: number;
    lastError?: string;
  }>;
  redirectResolution?: {
    attemptsTotal: number;
    resolvedCount: number;
    droppedCount: number;
    usedCacheCount: number;
    durationMs: number;
  };
  error?: string;
  raw?: unknown;
}

const DEFAULT_ALLOWED_SESSION_DIR_PREFIXES = [
  join(homedir(), '.config', 'opencode', 'scratchpad', 'sessions'),
  join(homedir(), '.config', 'opencode', 'MEMORY', 'WORK'),
];

function parseAllowedSessionDirPrefixes(): string[] {
  const raw = process.env.RESEARCH_SHELL_ALLOWED_SESSION_DIR_PREFIXES;
  if (!raw || raw.trim().length === 0) return DEFAULT_ALLOWED_SESSION_DIR_PREFIXES;

  const prefixes = raw
    .split(delimiter)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return prefixes.length > 0 ? prefixes : DEFAULT_ALLOWED_SESSION_DIR_PREFIXES;
}

function isWithinPrefix(targetPath: string, prefixPath: string): boolean {
  if (targetPath === prefixPath) return true;
  return targetPath.startsWith(prefixPath.endsWith(sep) ? prefixPath : prefixPath + sep);
}

async function validateSessionDirOrThrow(sessionDirRaw: string): Promise<string> {
  if (!sessionDirRaw || sessionDirRaw.trim().length === 0) {
    throw new Error('session_dir cannot be empty');
  }

  if (!isAbsolute(sessionDirRaw)) {
    throw new Error(`session_dir must be an absolute path, got: "${sessionDirRaw}"`);
  }

  const sessionDirReal = await realpath(sessionDirRaw);
  const st = await stat(sessionDirReal);
  if (!st.isDirectory()) {
    throw new Error(`session_dir must be a directory, got: "${sessionDirReal}"`);
  }

  const allowedPrefixes = parseAllowedSessionDirPrefixes();
  const allowedPrefixReals: string[] = [];
  for (const prefix of allowedPrefixes) {
    try {
      allowedPrefixReals.push(await realpath(prefix));
    } catch {
      allowedPrefixReals.push(resolve(prefix));
    }
  }

  if (!allowedPrefixReals.some((p) => isWithinPrefix(sessionDirReal, p))) {
    throw new Error(
      `session_dir is not allowed: "${sessionDirReal}". Allowed prefixes: ${allowedPrefixes.join(', ')}`,
    );
  }

  return sessionDirReal;
}

function formatTimestampForFilename(timestampIso: string): string {
  // ISO contains ':' which is awkward in filenames.
  return timestampIso.replace(/[:.]/g, '-');
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function writeFileAtomic(
  filePath: string,
  contents: string,
  mode: number = 0o600,
): Promise<void> {
  const tmpPath = `${filePath}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, contents, { encoding: 'utf8', mode });
  await rename(tmpPath, filePath);
}

function renderArtifactMarkdown(record: ArtifactRecord): string {
  const citations = record.citations ?? [];
  const configJson = JSON.stringify(record.config, null, 2);
  const rawJson =
    record.raw === undefined ? undefined : JSON.stringify(record.raw, null, 2);

  let out = '';
  out += '# Research Shell Result\n\n';
  out += `- timestamp: ${record.timestamp}\n`;
  out += `- call_id: ${record.callId}\n`;
  out += `- tool: ${record.tool}\n`;
  out += `- provider: ${record.provider}\n`;
  out += `- started_at: ${record.startedAt}\n`;
  out += `- finished_at: ${record.finishedAt}\n`;
  out += `- duration_ms: ${record.durationMs}\n`;
  out += `- success: ${record.success}\n\n`;

  if (record.warning) {
    out += `WARNING: ${record.warning}\n\n`;
  }

  out += '## Query\n\n';
  out += `Original: ${record.queryOriginal}\n\n`;
  out += `Sanitized: ${record.querySanitized}\n\n`;

  out += '## Config\n\n';
  out += '```json\n';
  out += `${configJson}\n`;
  out += '```\n\n';

  if (record.citationStyle || record.groundingStatus || record.webSearchQueries) {
    out += '## Grounding\n\n';
    if (record.citationStyle) out += `- citation_style: ${record.citationStyle}\n`;
    if (record.groundingStatus) out += `- grounding_status: ${record.groundingStatus}\n`;
    if (record.redirectResolution) {
      out += `- redirect_resolution: attempts=${record.redirectResolution.attemptsTotal}, resolved=${record.redirectResolution.resolvedCount}, dropped=${record.redirectResolution.droppedCount}, cache_hits=${record.redirectResolution.usedCacheCount}, duration_ms=${record.redirectResolution.durationMs}\n`;
    }
    out += '\n';

    if (record.webSearchQueries && record.webSearchQueries.length > 0) {
      out += '### webSearchQueries\n\n';
      for (const q of record.webSearchQueries) out += `- ${q}\n`;
      out += '\n';
    }

    if (record.resolvedReferences && record.resolvedReferences.length > 0) {
      out += '### Resolved References\n\n';
      for (const r of record.resolvedReferences) {
        out += `- [${r.refNum}] ${r.resolvedUrl}\n`;
      }
      out += '\n';
    }

    if (record.droppedReferences && record.droppedReferences.length > 0) {
      out += '### Dropped References\n\n';
      for (const r of record.droppedReferences) {
        out += `- chunk=${r.chunkIndex} status=${r.lastStatus ?? 'n/a'} url=${r.redirectUrl}`;
        if (r.lastError) out += ` error=${r.lastError}`;
        out += '\n';
      }
      out += '\n';
    }
  }

  if (record.success && record.content) {
    out += '## Content\n\n';
    out += `${record.content}\n\n`;
  }

  if (citations.length > 0 && record.provider !== 'gemini') {
    out += '## Citations\n\n';
    for (const url of citations) {
      out += `- ${url}\n`;
    }
    out += '\n';
  } else if (citations.length > 0 && record.provider === 'gemini') {
    out += '## Citations\n\n';
    out +=
      'Note: Gemini citations are grounding redirect URLs; use Resolved References above.\n\n';
  }

  if (!record.success && record.error) {
    out += '## Error\n\n';
    out += '```\n';
    out += `${record.error}\n`;
    out += '```\n\n';
  }

  if (rawJson !== undefined) {
    out += '## Raw Provider Payload\n\n';
    out += '```json\n';
    out += `${rawJson}\n`;
    out += '```\n';
  }

  return out;
}

async function appendEvidenceOrThrow(evidenceJsonlPath: string, entry: EvidenceEntry): Promise<void> {
  const line = `${JSON.stringify(entry)}\n`;
  await appendFile(evidenceJsonlPath, line);
}

function providerLabel(provider: Provider): string {
  switch (provider) {
    case 'gemini':
      return 'Gemini';
    case 'perplexity':
      return 'Perplexity';
    case 'grok':
      return 'Grok';
  }
}

// ============================================================================
// API Execution
// ============================================================================

interface ExecuteSearchResult {
  provider: Provider;
  tool: string;
  callId: string;
  evidenceJsonlPath: string;
  artifactJsonPath: string;
  artifactMdPath: string;
  success: boolean;
  /** Full tool return text (prefix + provider output or error). */
  text: string;
  /** Error message if success=false */
  error?: string;
}

/**
 * Execute a search using direct API client calls
 *
 * SECURITY: Input validation ensures safe query strings before API calls.
 * No shell interpretation - direct HTTP API calls only.
 */
async function executeSearch(
  provider: Provider,
  toolName: string,
  queryOriginal: string,
  sessionDirReal: string,
): Promise<ExecuteSearchResult> {
  const validation = validateQuery(queryOriginal);
  if (!validation.valid) {
    return {
      provider,
      tool: toolName,
      callId: 'validation_error',
      evidenceJsonlPath: '',
      artifactJsonPath: '',
      artifactMdPath: '',
      success: false,
      text: `Error: ${validation.error}`,
      error: validation.error,
    };
  }

  // Safe to access since we checked validation.valid above
  const sanitizedQuery = validation.sanitized as string;
  const callId = randomUUID();
  const startedAt = new Date();

  const rsDir = join(sessionDirReal, 'research-shell');
  const evidenceDir = join(rsDir, 'evidence');
  const evidenceJsonlPath = join(evidenceDir, 'research-shell.jsonl');

  await mkdir(rsDir, { recursive: true, mode: 0o700 });
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });

  const timestampIso = startedAt.toISOString();
  const tsFile = formatTimestampForFilename(timestampIso);
  const baseName = `${providerLabel(provider)}Search_${tsFile}_${callId}`;
  const artifactJsonPath = join(rsDir, `${baseName}.json`);
  const artifactMdPath = join(rsDir, `${baseName}.md`);

  let config: ReturnType<typeof loadConfig> | null = null;
  let configForArtifact: unknown;

  let result: SearchResult = { success: false, error: 'Uninitialized' };
  let durationMs = 0;

  try {
    config = loadConfig();
    configForArtifact =
      provider === 'gemini'
        ? config.gemini
        : provider === 'perplexity'
          ? config.perplexity
          : config.grok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = { success: false, error: message, raw: { configError: message } };
    configForArtifact = { configError: message };
  }

  if (config) {
    try {
      switch (provider) {
        case 'perplexity':
          result = await withRetry(
            () => perplexitySearch(sanitizedQuery, config.perplexity),
            toolName,
            RETRY_CONFIG,
          );
          break;
        case 'gemini':
          result = await withRetry(
            () => geminiSearch(sanitizedQuery, config.gemini),
            toolName,
            RETRY_CONFIG,
          );
          break;
        case 'grok':
          result = await withRetry(
            () => grokSearch(sanitizedQuery, config.grok),
            toolName,
            RETRY_CONFIG,
          );
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result = { success: false, error: message };
    }
  }

  const finishedAt = new Date();
  durationMs = finishedAt.getTime() - startedAt.getTime();

  let providerOutput = result.content || '';
  let warning: string | undefined;
  let citationStyle: ArtifactRecord['citationStyle'] | undefined;
  let webSearchQueries: string[] | undefined;
  let groundingStatus: ArtifactRecord['groundingStatus'] | undefined;
  let resolvedReferences: ArtifactRecord['resolvedReferences'] | undefined;
  let droppedReferences: ArtifactRecord['droppedReferences'] | undefined;
  let redirectResolution: ArtifactRecord['redirectResolution'] | undefined;

  if (provider === 'gemini' && result.success) {
    if (result.raw === undefined) {
      warning = 'WARNING: Gemini response missing raw grounding payload; emitting answer without citations.';
      groundingStatus = 'partial';
      providerOutput = providerOutput.replace(
        /https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[^\s)\]}>"']+/g,
        '[REDACTED_GROUNDING_REDIRECT_URL]',
      );
    } else {
      try {
        const rendered = await renderGeminiWithGrounding(result.raw, sessionDirReal, {
          ttlMs: 7 * 24 * 60 * 60 * 1000,
          timeoutMs: 8000,
          maxAttempts: 7,
          maxDelayMs: 20000,
          concurrency: 3,
          debug: process.env.DEBUG === '1',
        });

        providerOutput = rendered.content;
        warning = rendered.warning;
        citationStyle = rendered.citationStyle;
        webSearchQueries = rendered.webSearchQueries;
        groundingStatus = rendered.groundingStatus;
        resolvedReferences = rendered.resolvedReferences;
        droppedReferences = rendered.droppedReferences;
        redirectResolution = rendered.redirectResolution;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warning = `WARNING: Gemini grounding post-processing failed: ${message}`;
        groundingStatus = 'partial';
        // Never emit redirect URLs.
        providerOutput = providerOutput.replace(
          /https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[^\s)\]}>"']+/g,
          '[REDACTED_GROUNDING_REDIRECT_URL]',
        );
      }
    }
  } else if (
    provider !== 'gemini' &&
    result.success &&
    result.citations &&
    result.citations.length > 0
  ) {
    providerOutput += '\n\n--- Citations ---\n';
    result.citations.forEach((url, i) => {
      providerOutput += `[${i + 1}] ${url}\n`;
    });
  }

  const contentHash = providerOutput.length > 0 ? sha256(providerOutput) : undefined;

  const artifact: ArtifactRecord = {
    schemaVersion: 1,
    timestamp: timestampIso,
    callId,
    tool: toolName,
    provider,
    queryOriginal,
    querySanitized: sanitizedQuery,
    config: configForArtifact,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    success: result.success,
    warning,
    content: providerOutput || undefined,
    citations: result.citations,
    citationStyle,
    webSearchQueries,
    groundingStatus,
    resolvedReferences,
    droppedReferences,
    redirectResolution,
    error: result.error,
    raw: result.raw,
  };

  // Persist artifacts first, then append to evidence log.
  await writeFileAtomic(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
  await writeFileAtomic(artifactMdPath, `${renderArtifactMarkdown(artifact)}\n`);

  await appendEvidenceOrThrow(evidenceJsonlPath, {
    timestamp: timestampIso,
    callId,
    tool: toolName,
    provider,
    queryOriginal,
    querySanitized: sanitizedQuery,
    success: result.success,
    durationMs,
    outputLength: providerOutput.length || undefined,
    citationCount:
      citationStyle === 'ieee'
        ? resolvedReferences?.length
        : result.citations?.length,
    contentSha256: contentHash,
    artifactJsonPath,
    artifactMdPath,
    error: result.error,
  });

  let prefix =
    `[research-shell] Evidence saved.\n` +
    `RESEARCH_SHELL_CALL_ID=${callId}\n` +
    `RESEARCH_SHELL_ARTIFACT_JSON=${artifactJsonPath}\n` +
    `RESEARCH_SHELL_ARTIFACT_MD=${artifactMdPath}\n` +
    `RESEARCH_SHELL_EVIDENCE_JSONL=${evidenceJsonlPath}\n` +
    `INSTRUCTION: Ground your response in the saved artifacts; include the CALL_ID and artifact paths upstream.\n`;

  if (warning) {
    prefix += `[research-shell] ${warning}\n`;
  }

  if (webSearchQueries && webSearchQueries.length > 0) {
    prefix += `[research-shell] webSearchQueries:\n`;
    for (const q of webSearchQueries) {
      prefix += `- ${q}\n`;
    }
  }

  prefix += `--- BEGIN PROVIDER OUTPUT ---\n`;

  if (result.success) {
    return {
      provider,
      tool: toolName,
      callId,
      evidenceJsonlPath,
      artifactJsonPath,
      artifactMdPath,
      success: true,
      text: `${prefix}${providerOutput}`,
    };
  }

  const errorText = result.error || 'Unknown error';
  return {
    provider,
    tool: toolName,
    callId,
    evidenceJsonlPath,
    artifactJsonPath,
    artifactMdPath,
    success: false,
    text: `${prefix}Error: ${errorText}`,
    error: errorText,
  };
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new Server(
  { name: 'research-shell', version: '1.0.0' },
  {
    capabilities: { tools: { listChanged: false } },
    instructions: `Research Shell provides web search tools with automatic citations.

Available tools:
- perplexity_search: Deep research using Perplexity's Sonar Pro model. Best for comprehensive answers with inline citations.
- gemini_search: Multimodal research via Gemini with Google Search grounding. Best for: current events, Google-indexed content, image analysis, YouTube video understanding, visual content research.
- grok_search: X/Twitter-aware research via Grok. Best for real-time social media and trending topics.

Use these tools when you need:
- Verified information with citations
- Current/recent information beyond training cutoff
- Multiple perspectives on a topic
- Academic or technical research`,
  },
);

/**
 * All available tools with their definitions
 */
const ALL_TOOLS = [
  {
    name: 'perplexity_search',
    description:
      'Deep web research using Perplexity Sonar Pro. Returns comprehensive answers with inline citations. Best for: technical topics, academic research, detailed explanations, multi-source synthesis.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to execute',
        },
        session_dir: {
          type: 'string',
          description: 'Session directory for evidence logging',
        },
      },
      required: ['query', 'session_dir'],
    },
  },
  {
    name: 'gemini_search',
    description:
      'Multimodal research via Gemini with Google Search grounding. Supports text, images, and YouTube videos. Best for: current events, visual content analysis, video understanding, Google-indexed content.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to execute',
        },
        session_dir: {
          type: 'string',
          description: 'Session directory for evidence logging',
        },
      },
      required: ['query', 'session_dir'],
    },
  },
  {
    name: 'grok_search',
    description:
      'Real-time research via Grok with X/Twitter awareness. Best for: trending topics, social media sentiment, breaking news, real-time discussions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to execute',
        },
        session_dir: {
          type: 'string',
          description: 'Session directory for evidence logging',
        },
      },
      required: ['query', 'session_dir'],
    },
  },
];

// Register tool listing handler - filters tools based on AGENT_TYPE
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // If AGENT_TYPE is set, only return tools allowed for that agent
  // This prevents the model from seeing (and hallucinating) other tools
  if (AGENT_TYPE && AGENT_ALLOWED_TOOLS[AGENT_TYPE]) {
    const allowedToolNames = AGENT_ALLOWED_TOOLS[AGENT_TYPE];
    const filteredTools = ALL_TOOLS.filter((tool) =>
      allowedToolNames.includes(tool.name),
    );

    console.error(
      `[research-shell] Agent type "${AGENT_TYPE}" - exposing tools: ${allowedToolNames.join(', ')}`,
    );

    return { tools: filteredTools };
  }

  // No AGENT_TYPE set - return all tools (development/local mode)
  console.error(
    '[research-shell] No AGENT_TYPE set - exposing all tools (development mode)',
  );
  return { tools: ALL_TOOLS };
});

// Register tool call handler
server.setRequestHandler(
  CallToolRequestSchema,
  async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    const { query, session_dir } = args as {
      query: string;
      session_dir: string;
    };

    // H7: Server-side agent type validation
    // If AGENT_TYPE is set (from container), only allow matching tools
    if (AGENT_TYPE && AGENT_ALLOWED_TOOLS[AGENT_TYPE]) {
      const allowedTools = AGENT_ALLOWED_TOOLS[AGENT_TYPE];
      if (!allowedTools.includes(name)) {
        console.error(
          `SECURITY: Agent type "${AGENT_TYPE}" attempted to use disallowed tool "${name}". Allowed: ${allowedTools.join(', ')}`,
        );
        return {
          content: [
            {
              type: 'text',
              text: `Security Error: Tool "${name}" is not allowed for agent type "${AGENT_TYPE}"`,
            },
          ],
          isError: true,
        };
      }
    }

    if (!query || !session_dir) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Both query and session_dir are required',
          },
        ],
        isError: true,
      };
    }

    let sessionDirReal: string;
    try {
      sessionDirReal = await validateSessionDirOrThrow(session_dir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }

    let execResult: ExecuteSearchResult;
    try {
      switch (name) {
        case 'perplexity_search':
          execResult = await executeSearch(
            'perplexity',
            name,
            query,
            sessionDirReal,
          );
          break;
        case 'gemini_search':
          execResult = await executeSearch('gemini', name, query, sessionDirReal);
          break;
        case 'grok_search':
          execResult = await executeSearch('grok', name, query, sessionDirReal);
          break;
        default:
          return {
            content: [
              {
                type: 'text',
                text: `Error: Unknown tool "${name}"`,
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: execResult.text || 'No results returned',
        },
      ],
      isError: !execResult.success,
    };
  },
);

// ============================================================================
// Server Startup
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (not stdout, which is used for MCP protocol)
  console.error('Research Shell MCP Server started');
}

main().catch((error) => {
  console.error('Failed to start Research Shell MCP Server:', error);
  process.exit(1);
});
