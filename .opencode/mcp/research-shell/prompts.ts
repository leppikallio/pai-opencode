/**
 * Citation-Optimized System Prompts
 *
 * System prompts designed to maximize citation quality and URL inclusion
 * for research assistant agents using various AI providers.
 *
 * DESIGN PRINCIPLES:
 * - Explicit instruction to include source URLs
 * - Numbered citation format for easy reference
 * - References section requirement
 * - Provider-specific guidance
 *
 * USAGE:
 * Pass these prompts to the respective API clients to ensure
 * consistent citation formatting across all research providers.
 */

// ============================================================================
// Base Citation Prompt
// ============================================================================

/**
 * Base citation system prompt used by all providers
 *
 * This prompt establishes the core citation requirements:
 * - Include source URLs for every factual claim
 * - Use numbered citation format [1], [2], [3]
 * - Provide full references section with URLs
 * - Emphasize that responses without sources are useless
 */
export const CITATION_SYSTEM_PROMPT = `You are a research assistant. For EVERY factual claim you make:

1. INCLUDE THE SOURCE URL inline or in a references section
2. Use numbered citations [1], [2], [3] format
3. At the end, list all sources with full URLs

Example format:
"TypeScript was released in 2012 [1]. It is a superset of JavaScript [2].

References:
[1] https://www.typescriptlang.org/docs/handbook/release-notes/overview.html
[2] https://en.wikipedia.org/wiki/TypeScript"

CRITICAL: Responses without source URLs are USELESS. Always cite your sources.`;

// ============================================================================
// Provider-Specific Prompts
// ============================================================================

/**
 * Perplexity-specific system prompt
 *
 * Perplexity excels at web search with citations. This prompt:
 * - Builds on base citation requirements
 * - Reminds to include all relevant URLs from search results
 * - Leverages Perplexity's native citation capabilities
 */
export const PERPLEXITY_SYSTEM_PROMPT =
  CITATION_SYSTEM_PROMPT +
  `

Note: Include all relevant URLs from your search results.`;

/**
 * Gemini-specific system prompt
 *
 * Gemini uses Google Search grounding for factual information. This prompt:
 * - Builds on base citation requirements
 * - Emphasizes use of Google Search grounding
 * - Ensures current information with proper citations
 */
export const GEMINI_SYSTEM_PROMPT =
  CITATION_SYSTEM_PROMPT +
  `

Note: Use Google Search grounding to find current information and cite the sources.`;

/**
 * Grok-specific system prompt
 *
 * Grok has access to X/Twitter data and web search. This prompt:
 * - Builds on base citation requirements
 * - Encourages inclusion of X/Twitter sources when relevant
 * - Requires direct links to posts for social media citations
 */
export const GROK_SYSTEM_PROMPT =
  CITATION_SYSTEM_PROMPT +
  `

Note: Include X/Twitter sources when relevant, with direct links to posts.`;

// ============================================================================
// Prompt Utilities
// ============================================================================

/**
 * Get the appropriate system prompt for a given provider
 *
 * @param provider - The research provider name
 * @returns The optimized system prompt for that provider
 */
export function getSystemPrompt(
  provider: 'perplexity' | 'gemini' | 'grok',
): string {
  switch (provider) {
    case 'perplexity':
      return PERPLEXITY_SYSTEM_PROMPT;
    case 'gemini':
      return GEMINI_SYSTEM_PROMPT;
    case 'grok':
      return GROK_SYSTEM_PROMPT;
    default:
      return CITATION_SYSTEM_PROMPT;
  }
}

/**
 * Create a custom citation prompt with additional instructions
 *
 * @param basePrompt - The base prompt to extend (defaults to CITATION_SYSTEM_PROMPT)
 * @param additionalInstructions - Additional instructions to append
 * @returns Combined system prompt
 */
export function createCustomCitationPrompt(
  basePrompt: string = CITATION_SYSTEM_PROMPT,
  additionalInstructions: string,
): string {
  return `${basePrompt}

${additionalInstructions}`;
}

/**
 * Validate that a response includes citations
 *
 * This is a simple heuristic check for citation patterns in the response.
 * It checks for:
 * - Numbered citations like [1], [2], [3]
 * - URLs (http:// or https://)
 *
 * @param response - The response text to validate
 * @returns Object with validation result and details
 */
export function validateCitations(response: string): {
  hasCitations: boolean;
  hasUrls: boolean;
  citationCount: number;
  urlCount: number;
} {
  // Check for numbered citations [1], [2], etc.
  const citationMatches = response.match(/\[\d+\]/g);
  const citationCount = citationMatches ? citationMatches.length : 0;

  // Check for URLs
  const urlMatches = response.match(/https?:\/\/[^\s\]]+/g);
  const urlCount = urlMatches ? urlMatches.length : 0;

  return {
    hasCitations: citationCount > 0,
    hasUrls: urlCount > 0,
    citationCount,
    urlCount,
  };
}

/**
 * Extract all URLs from a response
 *
 * @param response - The response text
 * @returns Array of URLs found in the response
 */
export function extractUrls(response: string): string[] {
  const urlMatches = response.match(/https?:\/\/[^\s\]]+/g);
  return urlMatches || [];
}
