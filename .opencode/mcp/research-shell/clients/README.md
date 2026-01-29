# Research Shell MCP - API Clients

This directory contains direct API client implementations for research tools, replacing CLI subprocess calls with native API integration.

## Gemini Client (`gemini.ts`)

Comprehensive Gemini API client supporting both OAuth and API key authentication methods.

### Features

- **Dual Authentication Methods**
  - OAuth (Code Assist API) - Primary method with Google Search grounding
  - API Key (Standard Gemini API) - Fallback method

- **Google Search Grounding** (OAuth only)
  - Real-time web search integration
  - Automatic citation extraction
  - Formatted markdown sources

- **Token Management**
  - Automatic token refresh
  - Secure credential storage (~/.config/gemini-oauth/credentials.json)
  - Project ID caching

- **Error Handling**
  - Graceful fallback from OAuth to API key
  - Detailed error messages
  - Debug logging support

### Authentication Setup

#### Option 1: OAuth (Recommended - enables search grounding)

1. Set environment variables:
```bash
export GEMINI_OAUTH_CLIENT_ID="your-client-id"
export GEMINI_OAUTH_CLIENT_SECRET="your-client-secret"
```

2. Run authentication flow (using CLI tool or separate script)
3. Tokens will be stored in `~/.config/gemini-oauth/credentials.json`

#### Option 2: API Key

```bash
export GEMINI_API_KEY="your-api-key"
```

### Usage

```typescript
import { searchGemini, type SearchResult } from './clients/gemini';

// Basic search with OAuth (includes Google Search grounding)
const result = await searchGemini('What is TypeScript?');

if (result.success) {
  console.log(result.content);  // Response text with formatted citations
  console.log(result.citations); // Array of citation URLs
}

// Configure search options
const customResult = await searchGemini('Latest TypeScript features', {
  model: 'gemini-2.5-pro',
  maxTokens: 4096,
  temperature: 0.5,
  searchEnabled: true,
  authMethod: 'oauth', // or 'apikey'
  debug: true,
});

// Check authentication status
import { checkGeminiAuth } from './clients/gemini';

const authStatus = await checkGeminiAuth();
console.log(`OAuth available: ${authStatus.oauth}`);
console.log(`API key available: ${authStatus.apikey}`);
```

### Configuration Options

```typescript
interface GeminiConfig {
  model?: string;           // Default: 'gemini-2.5-flash'
  maxTokens?: number;       // Default: 8192
  temperature?: number;     // Default: 0.7 (0-2)
  authMethod?: 'oauth' | 'apikey'; // Default: auto-detect
  searchEnabled?: boolean;  // Default: true (OAuth only)
  debug?: boolean;          // Default: false
}
```

### Response Format

```typescript
interface SearchResult {
  success: boolean;
  content?: string;         // Response text with citations
  citations?: string[];     // Array of source URLs
  error?: string;           // Error message if failed
}
```

### OAuth Endpoints

- **Code Assist API**: `https://cloudcode-pa.googleapis.com/v1internal:generateContent`
- **Required Scopes**:
  - `https://www.googleapis.com/auth/cloud-platform`
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/userinfo.profile`

### API Key Endpoint

- **Standard Gemini API**: `https://generativelanguage.googleapis.com/v1beta`

### Google Search Grounding

When enabled (OAuth only), the client:

1. Sends `tools: [{ googleSearch: {} }]` in the request
2. Gemini performs web searches to enhance responses
3. Returns `groundingMetadata` with web sources
4. Client extracts citations and formats them as markdown

Example response with citations:

```
TypeScript is a strongly typed superset of JavaScript...

---
**Sources:**
- [TypeScript Official Documentation](https://www.typescriptlang.org/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
```

### Error Handling

The client handles various error scenarios:

- **OAuth not configured**: Returns error or falls back to API key
- **Token expired**: Automatically refreshes using refresh token
- **API request failed**: Returns detailed error message
- **No content in response**: Returns descriptive error

### Security

- Credentials stored with 0600 permissions
- Tokens automatically refreshed before expiry
- No shell command execution (direct API calls)
- Environment variable validation

### Implementation Notes

1. **Token Storage**: Credentials stored in `~/.config/gemini-oauth/credentials.json`
2. **Singleton Pattern**: OAuth client and project ID cached to avoid repeated setup
3. **Automatic Fallback**: If OAuth fails and API key is available, automatically retries
4. **User Onboarding**: Automatically handles Code Assist API onboarding if needed

### Future Enhancements

- [ ] Browser-based OAuth flow for initial authentication
- [ ] Support for streaming responses
- [ ] Batch request support
- [ ] Custom grounding sources
- [ ] Safety settings configuration
