import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Configuration for Perplexity AI research
 */
export interface PerplexityConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
}

/**
 * Configuration for Google Gemini research
 */
export interface GeminiConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  authMethod: 'oauth' | 'apikey';
  searchEnabled: boolean;
}

/**
 * Configuration for Grok research
 */
export interface GrokConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  searchEnabled: boolean;
  returnCitations: boolean;
  systemPrompt?: string;
}

/**
 * Complete research shell configuration
 */
export interface ResearchShellConfig {
  perplexity: PerplexityConfig;
  gemini: GeminiConfig;
  grok: GrokConfig;
}

/**
 * Load API key from ~/.env file or environment variables
 * @param keyName The name of the API key to load
 * @returns The API key value
 * @throws Error if the API key is not found
 */
export function loadApiKey(keyName: string): string {
  // First try ~/.env file
  const envPath = join(homedir(), '.env');
  try {
    const envContent = readFileSync(envPath, 'utf-8');
    const regex = new RegExp(`${keyName}=(.+)`, 'm');
    const match = envContent.match(regex);
    if (match) {
      return match[1].trim();
    }
  } catch (_e) {
    // File doesn't exist or can't be read, will try environment variable
  }

  // Fallback to environment variable
  const envValue = process.env[keyName];
  if (envValue) {
    return envValue;
  }

  throw new Error(`${keyName} not found in ~/.env or environment variables`);
}

/**
 * Require an environment variable, throwing a clear error if missing
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        'This variable should be passed by the host orchestrator from config/shovel-handle.json.\n' +
        'If running standalone, ensure the orchestrator passes researcher config via env vars.',
    );
  }
  return value;
}

/**
 * Require a numeric environment variable
 */
function requireNumericEnv(name: string): number {
  const value = requireEnv(name);
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) {
    throw new Error(
      `Environment variable ${name} must be a number, got: "${value}"`,
    );
  }
  return num;
}

/**
 * Read optional environment variable.
 */
function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

/**
 * Parse Gemini auth method from environment.
 *
 * Requirements:
 * - Default: API key auth when missing
 * - Accepts: "api-key" | "apikey" | "oauth" (case-insensitive)
 */
function parseGeminiAuthMethod(): 'apikey' | 'oauth' {
  const raw = optionalEnv('GEMINI_AUTH_METHOD');
  if (!raw) return 'apikey';

  const normalized = raw.trim().toLowerCase();

  if (normalized === 'oauth') return 'oauth';
  if (normalized === 'api-key' || normalized === 'apikey') return 'apikey';

  throw new Error(
    `Invalid GEMINI_AUTH_METHOD: "${raw}". Allowed: "api-key", "apikey", "oauth". ` +
      'Omit GEMINI_AUTH_METHOD to default to "api-key".',
  );
}

/**
 * Load configuration from environment variables
 *
 * NOTE: This module runs inside Docker containers as an MCP server subprocess.
 * It cannot access the host's shovel-handle.json config file.
 * Configuration values MUST be passed via environment variables by mcp-loader.ts
 * which reads from shovel-handle.json on the host side.
 *
 * NO DEFAULTS - Missing config = loud failure with clear error message.
 *
 * @returns Complete research shell configuration
 * @throws Error if any required environment variable is missing
 */
export function loadConfig(): ResearchShellConfig {
  // All values are REQUIRED - no defaults, fail loudly if missing
  const config: ResearchShellConfig = {
    perplexity: {
      model: requireEnv('PERPLEXITY_MODEL'),
      maxTokens: requireNumericEnv('PERPLEXITY_MAX_TOKENS'),
      temperature: requireNumericEnv('PERPLEXITY_TEMPERATURE'),
      systemPrompt: undefined,
    },
    gemini: {
      model: requireEnv('GEMINI_MODEL'),
      maxTokens: requireNumericEnv('GEMINI_MAX_TOKENS'),
      temperature: requireNumericEnv('GEMINI_TEMPERATURE'),
      authMethod: parseGeminiAuthMethod(),
      searchEnabled: requireEnv('GEMINI_SEARCH_ENABLED') !== 'false',
    },
    grok: {
      model: requireEnv('GROK_MODEL'),
      maxTokens: requireNumericEnv('GROK_MAX_TOKENS'),
      temperature: requireNumericEnv('GROK_TEMPERATURE'),
      searchEnabled: requireEnv('GROK_SEARCH_ENABLED') !== 'false',
      returnCitations: requireEnv('GROK_RETURN_CITATIONS') !== 'false',
      systemPrompt: undefined,
    },
  };

  return config;
}
