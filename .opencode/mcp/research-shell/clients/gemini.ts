/**
 * Gemini API Client
 *
 * Supports both OAuth (Code Assist API) and API key authentication.
 * OAuth method enables Google Search grounding for up-to-date information with citations.
 *
 * Authentication Methods:
 * 1. OAuth (Code Assist API) - Primary method, enables Google Search grounding
 *    - Uses google-auth-library OAuth2Client
 *    - Client ID from GEMINI_OAUTH_CLIENT_ID env var
 *    - Client Secret from GEMINI_OAUTH_CLIENT_SECRET env var
 *    - Tokens stored in ~/.gemini-oauth-tokens.json
 *
 * 2. API Key - Fallback method, standard Gemini API
 *    - Key from GEMINI_API_KEY env var
 *    - Does not support Google Search grounding
 *
 * Usage:
 *   import { searchGemini, GeminiConfig } from './gemini';
 *   const result = await searchGemini('Your query', { searchEnabled: true });
 */

import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OAuth2Client } from 'google-auth-library';

// ============================================================================
// Configuration
// ============================================================================

/** OAuth2 client credentials from environment */
const OAUTH_CLIENT_ID = process.env.GEMINI_OAUTH_CLIENT_ID || '';
const OAUTH_CLIENT_CRED = process.env.GEMINI_OAUTH_CLIENT_SECRET || '';

/** API key from environment (fallback method) */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

/** OAuth scopes required for Code Assist API */
const _OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/** Code Assist API endpoint (OAuth method) */
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';

/** Standard Gemini API endpoint (API key method) */
const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

/** Token storage path for OAuth credentials */
const TOKENS_DIR = join(homedir(), '.config', 'gemini-oauth');
const TOKENS_PATH = join(TOKENS_DIR, 'credentials.json');

/** User-Agent header */
const USER_AGENT = `GeminiClient/1.0.0 (${process.platform}; ${process.arch})`;

// ============================================================================
// Type Definitions
// ============================================================================

export interface GeminiConfig {
  /** Model to use (default: gemini-2.5-flash) */
  model?: string;
  /** Maximum tokens in response (default: 8192) */
  maxTokens?: number;
  /** Temperature 0-2 (default: 0.7) */
  temperature?: number;
  /** Authentication method: oauth or apikey (default: auto-detect) */
  authMethod?: 'oauth' | 'apikey';
  /** Enable Google Search grounding (only works with OAuth, default: true) */
  searchEnabled?: boolean;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

export interface SearchResult {
  success: boolean;
  content?: string;
  citations?: string[];
  error?: string;
}

interface Credentials {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
  project_id?: string;
}

interface GroundingMetadata {
  groundingChunks?: Array<{
    web?: {
      uri: string;
      title?: string;
    };
  }>;
  groundingSupports?: Array<{
    segment?: {
      startIndex?: number;
      endIndex?: number;
      text?: string;
    };
    groundingChunkIndices?: number[];
  }>;
  webSearchQueries?: string[];
}

// ============================================================================
// Singleton Cache
// ============================================================================

let cachedOAuthClient: OAuth2Client | null = null;
let cachedProjectId: string | null = null;

/**
 * Pre-authenticated access token from environment (for containerized execution).
 * When running in Docker containers, the orchestrator fetches a fresh token on
 * the host and passes it via GEMINI_OAUTH_ACCESS_TOKEN. This maintains container
 * isolation - the MCP server never accesses host filesystem for credentials.
 */
const ENV_ACCESS_TOKEN = process.env.GEMINI_OAUTH_ACCESS_TOKEN || '';

/**
 * Clear cached OAuth client (useful for testing or forcing re-auth)
 */
export function clearGeminiCache(): void {
  cachedOAuthClient = null;
  cachedProjectId = null;
}

// ============================================================================
// OAuth Token Management
// ============================================================================

function ensureTokensDir(): void {
  if (!existsSync(TOKENS_DIR)) {
    mkdirSync(TOKENS_DIR, { recursive: true, mode: 0o700 });
  }
}

function saveCredentials(credentials: Credentials): void {
  ensureTokensDir();
  writeFileSync(TOKENS_PATH, JSON.stringify(credentials, null, 2));
  chmodSync(TOKENS_PATH, 0o600);
}

function loadCredentials(): Credentials | null {
  // Debug: Log credential path resolution
  const debug = process.env.GEMINI_DEBUG === '1' || process.env.DEBUG === '1';
  if (debug) {
    console.error(`[gemini] HOME=${process.env.HOME}`);
    console.error(`[gemini] homedir()=${homedir()}`);
    console.error(`[gemini] TOKENS_DIR=${TOKENS_DIR}`);
    console.error(`[gemini] TOKENS_PATH=${TOKENS_PATH}`);
    console.error(
      `[gemini] existsSync(TOKENS_PATH)=${existsSync(TOKENS_PATH)}`,
    );
  }

  try {
    if (existsSync(TOKENS_PATH)) {
      const data = readFileSync(TOKENS_PATH, 'utf-8');
      if (debug) {
        console.error(
          `[gemini] Successfully loaded credentials from ${TOKENS_PATH}`,
        );
      }
      return JSON.parse(data);
    } else if (debug) {
      console.error(`[gemini] Credentials file not found at ${TOKENS_PATH}`);
    }
  } catch (error) {
    if (debug) {
      console.error(`[gemini] Error loading credentials: ${error}`);
    }
    // Ignore errors, return null
  }
  return null;
}

function createOAuthClient(): OAuth2Client {
  return new OAuth2Client(
    OAUTH_CLIENT_ID,
    OAUTH_CLIENT_CRED,
    'http://localhost:0/oauth2callback',
  );
}

/**
 * Validate credentials and refresh if needed
 */
async function validateAndRefreshCredentials(
  client: OAuth2Client,
  credentials: Credentials,
  debug: boolean,
): Promise<boolean> {
  try {
    client.setCredentials({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      expiry_date: credentials.expiry_date,
    });

    // Check if token is expired
    if (credentials.expiry_date && credentials.expiry_date < Date.now()) {
      if (debug) {
        console.error('[gemini] Access token expired, attempting refresh...');
      }

      if (credentials.refresh_token) {
        const { credentials: newTokens } = await client.refreshAccessToken();
        const newCredentials: Credentials = {
          access_token: newTokens.access_token ?? '',
          refresh_token: newTokens.refresh_token || credentials.refresh_token,
          scope: newTokens.scope || credentials.scope,
          token_type: newTokens.token_type || credentials.token_type,
          expiry_date: newTokens.expiry_date || undefined,
          project_id: credentials.project_id,
        };

        // Try to save refreshed credentials (may fail in read-only containers)
        try {
          saveCredentials(newCredentials);
          if (debug) {
            console.error('[gemini] Refreshed credentials saved to disk');
          }
        } catch (saveError) {
          // In Docker containers, credentials mount is read-only
          // Token refresh still works, just won't persist to disk
          if (debug) {
            console.error(
              `[gemini] Could not save refreshed credentials (read-only?): ${saveError}`,
            );
          }
        }

        client.setCredentials(newTokens);

        if (debug) {
          console.error('[gemini] Token refreshed successfully');
        }

        return true;
      }

      return false;
    }

    // Verify token is valid by checking with server
    const { token } = await client.getAccessToken();
    if (token) {
      await client.getTokenInfo(token);
      return true;
    }

    return false;
  } catch (error) {
    if (debug) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[gemini] Credential validation failed: ${message}`);
    }
    return false;
  }
}

/**
 * Get authenticated OAuth client
 * Returns null if OAuth is not configured or credentials are invalid
 */
async function getAuthenticatedOAuthClient(
  debug: boolean,
): Promise<OAuth2Client | null> {
  // Check if OAuth is configured
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_CRED) {
    if (debug) {
      console.error(
        '[gemini] OAuth not configured (missing GEMINI_OAUTH_CLIENT_ID or GEMINI_OAUTH_CLIENT_SECRET)',
      );
    }
    return null;
  }

  // Return cached client if available
  if (cachedOAuthClient) {
    return cachedOAuthClient;
  }

  const client = createOAuthClient();

  // Set up token refresh handler
  client.on('tokens', (tokens) => {
    const credentials = loadCredentials();
    const newCredentials: Credentials = {
      access_token: tokens.access_token ?? '',
      refresh_token: tokens.refresh_token || credentials?.refresh_token,
      scope: tokens.scope || credentials?.scope,
      token_type: tokens.token_type || credentials?.token_type,
      expiry_date: tokens.expiry_date || undefined,
      project_id: credentials?.project_id,
    };
    saveCredentials(newCredentials);
  });

  // Check for existing credentials
  const credentials = loadCredentials();
  if (credentials) {
    const isValid = await validateAndRefreshCredentials(
      client,
      credentials,
      debug,
    );
    if (isValid) {
      if (debug) {
        console.error('[gemini] Using cached OAuth credentials');
      }
      cachedOAuthClient = client;
      cachedProjectId = credentials.project_id || null;
      return client;
    }
  }

  if (debug) {
    console.error(
      '[gemini] No valid OAuth credentials found. Run authentication flow separately.',
    );
  }

  return null;
}

// ============================================================================
// Code Assist API - User Setup
// ============================================================================

/**
 * Setup user and get project ID from Code Assist API
 * This is required for OAuth method
 */
async function setupUser(
  client: OAuth2Client,
  debug: boolean,
): Promise<string> {
  const { token } = await client.getAccessToken();

  if (!token) {
    throw new Error('No access token available');
  }

  const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:loadCodeAssist`;

  const requestBody = {
    metadata: {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
    },
  };

  if (debug) {
    console.error('[gemini] Setting up user with Code Assist API...');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Setup failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    cloudaicompanionProject?: string;
    allowedTiers?: Array<{ id: string; isDefault?: boolean }>;
  };

  let projectId = data.cloudaicompanionProject;

  // If not set up yet, need to onboard
  if (!projectId && data.allowedTiers) {
    if (debug) {
      console.error('[gemini] User not onboarded, initiating onboarding...');
    }

    const defaultTier =
      data.allowedTiers.find((t) => t.isDefault) || data.allowedTiers[0];

    const onboardUrl = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:onboardUser`;
    const onboardBody = {
      tierId: defaultTier.id,
      metadata: {
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI',
      },
    };

    let onboardResponse = await fetch(onboardUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(onboardBody),
    });

    if (!onboardResponse.ok) {
      const errorText = await onboardResponse.text();
      throw new Error(
        `Onboarding failed (${onboardResponse.status}): ${errorText}`,
      );
    }

    interface OnboardingResponse {
      done?: boolean;
      response?: {
        cloudaicompanionProject?: { id?: string };
      };
    }

    let onboardData = (await onboardResponse.json()) as OnboardingResponse;

    // Poll for completion
    while (!onboardData.done) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      onboardResponse = await fetch(onboardUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(onboardBody),
      });

      if (!onboardResponse.ok) {
        const errorText = await onboardResponse.text();
        throw new Error(
          `Onboarding poll failed (${onboardResponse.status}): ${errorText}`,
        );
      }

      onboardData = (await onboardResponse.json()) as OnboardingResponse;
    }

    projectId = onboardData.response?.cloudaicompanionProject?.id;
  }

  if (!projectId) {
    throw new Error('Could not obtain project ID from Code Assist API');
  }

  return projectId;
}

/**
 * Get project ID for Code Assist API
 */
async function getProjectId(
  client: OAuth2Client,
  debug: boolean,
): Promise<string> {
  // Return cached project ID if available
  if (cachedProjectId) {
    return cachedProjectId;
  }

  // Check credentials for cached project ID
  const credentials = loadCredentials();
  if (credentials?.project_id) {
    cachedProjectId = credentials.project_id;
    return credentials.project_id;
  }

  // Setup user to get project ID
  const projectId = await setupUser(client, debug);

  // Save project ID to credentials
  if (credentials) {
    credentials.project_id = projectId;
    saveCredentials(credentials);
  }

  cachedProjectId = projectId;
  return projectId;
}

// ============================================================================
// Citation Extraction
// ============================================================================

/**
 * Extract citations from grounding metadata
 */
function extractCitations(metadata: GroundingMetadata): string[] {
  const citations: string[] = [];

  if (metadata.groundingChunks) {
    for (const chunk of metadata.groundingChunks) {
      if (chunk.web?.uri) {
        citations.push(chunk.web.uri);
      }
    }
  }

  return citations;
}

/**
 * Format citations as markdown links
 */
function formatCitations(metadata: GroundingMetadata): string | undefined {
  if (!metadata.groundingChunks || metadata.groundingChunks.length === 0) {
    return undefined;
  }

  let citationsText = '\n\n---\n**Sources:**\n';

  for (const [index, chunk] of metadata.groundingChunks.entries()) {
    if (chunk.web?.uri) {
      const title = chunk.web.title || `Source ${index + 1}`;
      citationsText += `- [${title}](${chunk.web.uri})\n`;
    }
  }

  return citationsText;
}

// ============================================================================
// OAuth Method (Code Assist API)
// ============================================================================

/**
 * Make a Code Assist API request with a given access token.
 * This is the core API call logic, factored out to support both:
 * 1. Environment-provided tokens (container execution)
 * 2. OAuth client tokens (local execution)
 */
async function makeCodeAssistRequest(
  query: string,
  accessToken: string,
  projectId: string,
  config: Required<GeminiConfig>,
): Promise<SearchResult> {
  const { model, maxTokens, temperature, searchEnabled, debug } = config;

  const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:generateContent`;
  const userPromptId = randomBytes(16).toString('hex');

  const requestBody: {
    model: string;
    project: string;
    user_prompt_id: string;
    request: {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      generationConfig: {
        temperature: number;
        maxOutputTokens: number;
      };
      tools?: Array<{ googleSearch: Record<string, never> }>;
    };
  } = {
    model,
    project: projectId,
    user_prompt_id: userPromptId,
    request: {
      contents: [
        {
          role: 'user',
          parts: [{ text: query }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    },
  };

  // Add Google Search grounding if enabled
  if (searchEnabled) {
    requestBody.request.tools = [{ googleSearch: {} }];
  }

  if (debug) {
    console.error('[gemini] Making OAuth request to:', url);
    console.error('[gemini] Model:', model);
    console.error('[gemini] Search enabled:', searchEnabled);
    console.error('[gemini] Query length:', query.length);
  }

  const startTime = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(requestBody),
  });

  const duration = Date.now() - startTime;

  if (debug) {
    console.error(
      `[gemini] Response status: ${response.status} (${duration}ms)`,
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `API request failed (${response.status})`;

    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
      }
    } catch {
      errorMessage += `: ${errorText}`;
    }

    return {
      success: false,
      error: errorMessage,
    };
  }

  const data = (await response.json()) as {
    response?: {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: GroundingMetadata;
      }>;
    };
  };

  const content = data.response?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    return {
      success: false,
      error: 'No content in response',
    };
  }

  // Extract grounding metadata if search was enabled
  const groundingMetadata = data.response?.candidates?.[0]?.groundingMetadata;
  const citations = groundingMetadata
    ? extractCitations(groundingMetadata)
    : [];

  // Add formatted citations to content if available
  let finalContent = content;
  if (groundingMetadata && searchEnabled) {
    const citationsText = formatCitations(groundingMetadata);
    if (citationsText) {
      finalContent += citationsText;
    }

    // Log search queries used in debug mode
    if (debug && groundingMetadata.webSearchQueries) {
      console.error('\n[gemini] Search queries used:');
      for (const q of groundingMetadata.webSearchQueries) {
        console.error(`  - ${q}`);
      }
    }
  }

  return {
    success: true,
    content: finalContent,
    citations,
  };
}

/**
 * Search using environment-provided access token (containerized execution).
 * When running in Docker, the orchestrator passes a fresh token via
 * GEMINI_OAUTH_ACCESS_TOKEN environment variable. This maintains container
 * isolation - no host filesystem access needed.
 */
async function searchWithEnvToken(
  query: string,
  config: Required<GeminiConfig>,
): Promise<SearchResult> {
  const { debug } = config;

  if (debug) {
    console.error('[gemini] Using environment-provided OAuth access token');
  }

  // Get project ID - try environment first, then fall back to credentials file
  // Note: In container execution, project_id should also be available
  let projectId = process.env.GEMINI_PROJECT_ID || '';

  if (!projectId) {
    // Try to get from credentials file (may work if mounted read-only)
    const credentials = loadCredentials();
    if (credentials?.project_id) {
      projectId = credentials.project_id;
    }
  }

  if (!projectId) {
    // Last resort: try to set up user with the env token
    // This requires making an API call but is a one-time operation
    try {
      if (debug) {
        console.error('[gemini] No project ID found, setting up user...');
      }

      const client = new OAuth2Client();
      client.setCredentials({ access_token: ENV_ACCESS_TOKEN });
      projectId = await setupUser(client, debug);

      if (debug) {
        console.error(`[gemini] Got project ID: ${projectId}`);
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to get project ID: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  try {
    return await makeCodeAssistRequest(
      query,
      ENV_ACCESS_TOKEN,
      projectId,
      config,
    );
  } catch (error) {
    return {
      success: false,
      error: `Env token method failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Search using OAuth method (Code Assist API)
 * Supports Google Search grounding
 */
async function searchWithOAuth(
  query: string,
  config: Required<GeminiConfig>,
): Promise<SearchResult> {
  const { debug } = config;

  // PRIORITY 1: Use environment-provided access token (container execution)
  // This maintains container isolation - no host filesystem access needed
  if (ENV_ACCESS_TOKEN) {
    if (debug) {
      console.error('[gemini] GEMINI_OAUTH_ACCESS_TOKEN found in environment');
    }
    return searchWithEnvToken(query, config);
  }

  // PRIORITY 2: Use file-based OAuth credentials (local execution)
  if (debug) {
    console.error('[gemini] No env token, trying file-based OAuth credentials');
  }

  try {
    // Get authenticated OAuth client
    const client = await getAuthenticatedOAuthClient(debug);

    if (!client) {
      return {
        success: false,
        error:
          'OAuth authentication not available. Configure GEMINI_OAUTH_CLIENT_ID and GEMINI_OAUTH_CLIENT_SECRET, or use API key method.',
      };
    }

    // Get project ID
    const projectId = await getProjectId(client, debug);

    // Get access token
    const { token } = await client.getAccessToken();

    if (!token) {
      return {
        success: false,
        error: 'No access token available',
      };
    }

    // Use the shared request function
    return await makeCodeAssistRequest(query, token, projectId, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `OAuth method failed: ${message}`,
    };
  }
}

// ============================================================================
// API Key Method (Standard Gemini API)
// ============================================================================

/**
 * Search using API key method (standard Gemini API)
 * Supports Google Search grounding via the google_search tool.
 */
async function searchWithApiKey(
  query: string,
  config: Required<GeminiConfig>,
): Promise<SearchResult> {
  const { model, maxTokens, temperature, searchEnabled, debug } = config;

  try {
    if (!GEMINI_API_KEY) {
      return {
        success: false,
        error:
          'API key not configured. Set GEMINI_API_KEY environment variable.',
      };
    }

    const url = `${GEMINI_API_ENDPOINT}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    const requestBody: {
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig: {
        temperature: number;
        maxOutputTokens: number;
      };
      tools?: Array<{ google_search: Record<string, never> }>;
    } = {
      contents: [
        {
          parts: [{ text: query }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    };

    // Add Google Search grounding if enabled
    if (searchEnabled) {
      requestBody.tools = [{ google_search: {} }];
    }

    if (debug) {
      console.error(
        '[gemini] Making API key request to:',
        url.replace(GEMINI_API_KEY, '***'),
      );
      console.error('[gemini] Model:', model);
      console.error('[gemini] Search enabled:', searchEnabled);
      console.error('[gemini] Query length:', query.length);
    }

    const startTime = Date.now();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(requestBody),
    });

    const duration = Date.now() - startTime;

    if (debug) {
      console.error(
        `[gemini] Response status: ${response.status} (${duration}ms)`,
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API request failed (${response.status})`;

      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorMessage = errorJson.error.message;
        }
      } catch {
        errorMessage += `: ${errorText}`;
      }

      return {
        success: false,
        error: errorMessage,
      };
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: GroundingMetadata;
      }>;
    };

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      return {
        success: false,
        error: 'No content in response',
      };
    }

    // Extract grounding metadata if search was enabled
    const groundingMetadata = data.candidates?.[0]?.groundingMetadata;
    const citations = groundingMetadata ? extractCitations(groundingMetadata) : [];

    // Add formatted citations to content if available
    let finalContent = content;
    if (groundingMetadata && searchEnabled) {
      const citationsText = formatCitations(groundingMetadata);
      if (citationsText) {
        finalContent += citationsText;
      }

      if (debug && groundingMetadata.webSearchQueries) {
        console.error('\n[gemini] Search queries used:');
        for (const q of groundingMetadata.webSearchQueries) {
          console.error(`  - ${q}`);
        }
      }
    }

    return {
      success: true,
      content: finalContent,
      citations,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `API key method failed: ${message}`,
    };
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Search using Gemini API
 *
 * Automatically selects authentication method:
 * 1. If authMethod is specified, uses that
 * 2. Otherwise tries OAuth first (supports search grounding)
 * 3. Falls back to API key if OAuth not available
 *
 * @param query - The search query
 * @param config - Configuration options
 * @returns SearchResult with content and citations
 */
export async function searchGemini(
  query: string,
  config: GeminiConfig = {},
): Promise<SearchResult> {
  // Set defaults
  const fullConfig: Required<GeminiConfig> = {
    model: config.model || 'gemini-2.5-flash',
    maxTokens: config.maxTokens || 8192,
    temperature: config.temperature ?? 0.7,
    authMethod: config.authMethod || 'oauth',
    searchEnabled: config.searchEnabled ?? true,
    debug: config.debug ?? false,
  };

  // Validate query
  if (!query || query.trim().length === 0) {
    return {
      success: false,
      error: 'Query cannot be empty',
    };
  }

  // Auto-detect authentication method if not specified
  if (!config.authMethod) {
    // Try OAuth first if configured
    if (OAUTH_CLIENT_ID && OAUTH_CLIENT_CRED) {
      fullConfig.authMethod = 'oauth';
    }
    // Fall back to API key
    else if (GEMINI_API_KEY) {
      fullConfig.authMethod = 'apikey';
    }
    // No auth configured
    else {
      return {
        success: false,
        error:
          'No authentication configured. Set GEMINI_OAUTH_CLIENT_ID + GEMINI_OAUTH_CLIENT_SECRET (for search grounding) or GEMINI_API_KEY.',
      };
    }
  }

  // Execute search with selected method
  if (fullConfig.authMethod === 'oauth') {
    const result = await searchWithOAuth(query, fullConfig);

    // If OAuth fails and API key is available, try falling back
    if (!result.success && GEMINI_API_KEY && fullConfig.debug) {
      console.error('[gemini] OAuth failed, falling back to API key method...');
      fullConfig.authMethod = 'apikey';
      return await searchWithApiKey(query, fullConfig);
    }

    return result;
  } else {
    return await searchWithApiKey(query, fullConfig);
  }
}

/**
 * Check if Gemini authentication is configured
 *
 * @returns Object with auth status for both methods
 */
export async function checkGeminiAuth(): Promise<{
  oauth: boolean;
  apikey: boolean;
}> {
  const oauth = Boolean(
    OAUTH_CLIENT_ID && OAUTH_CLIENT_CRED && loadCredentials(),
  );
  const apikey = Boolean(GEMINI_API_KEY);

  return { oauth, apikey };
}
