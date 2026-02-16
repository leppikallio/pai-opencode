#!/usr/bin/env bun

/**
 * Independent test script for research API clients
 *
 * Tests each client in isolation before Docker integration.
 * Run with: bun run src/mcp/research-shell/test-clients.ts [perplexity|gemini|grok|all]
 *
 * Requirements:
 * - PERPLEXITY_API_KEY for Perplexity tests
 * - GEMINI_API_KEY or GEMINI_OAUTH_* for Gemini tests
 * - GROK_API_KEY or GROKAI_API_KEY for Grok tests
 */

import { searchGemini } from './clients/gemini.js';
import { grokSearch } from './clients/grok.js';
import { perplexitySearch } from './clients/perplexity.js';
import { loadConfig } from './config.js';
import type { SearchResult } from './types.js';

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_QUERY =
  'What is TypeScript and when was it first released? Include sources.';

interface TestResult {
  client: string;
  success: boolean;
  duration: number;
  contentLength?: number;
  citationCount?: number;
  error?: string;
  preview?: string;
  citations?: string[];
}

// ============================================================================
// Test Runners
// ============================================================================

async function testPerplexity(): Promise<TestResult> {
  const client = 'perplexity';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${client.toUpperCase()}`);
  console.log(`${'='.repeat(60)}`);

  if (!process.env.PERPLEXITY_API_KEY) {
    return {
      client,
      success: false,
      duration: 0,
      error: 'PERPLEXITY_API_KEY not set',
    };
  }

  const config = loadConfig();
  const start = Date.now();

  try {
    console.log(`Query: "${TEST_QUERY}"`);
    console.log(`Model: ${config.perplexity.model}`);
    console.log('Executing...');

    const result: SearchResult = await perplexitySearch(
      TEST_QUERY,
      config.perplexity,
    );
    const duration = Date.now() - start;

    if (result.success) {
      console.log(`\n✅ SUCCESS (${duration}ms)`);
      console.log(`Content length: ${result.content?.length || 0} chars`);
      console.log(`Citations: ${result.citations?.length || 0}`);

      if (result.citations && result.citations.length > 0) {
        console.log('\nCitations found:');
        result.citations.slice(0, 5).forEach((url, i) => {
          console.log(`  [${i + 1}] ${url}`);
        });
      }

      console.log('\nContent preview:');
      console.log(`${result.content?.slice(0, 500)}...`);

      return {
        client,
        success: true,
        duration,
        contentLength: result.content?.length,
        citationCount: result.citations?.length,
        preview: result.content?.slice(0, 200),
        citations: result.citations,
      };
    } else {
      console.log(`\n❌ FAILED: ${result.error}`);
      return {
        client,
        success: false,
        duration,
        error: result.error,
      };
    }
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(`\n❌ EXCEPTION: ${errorMsg}`);
    return {
      client,
      success: false,
      duration,
      error: errorMsg,
    };
  }
}

async function testGemini(): Promise<TestResult> {
  const client = 'gemini';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${client.toUpperCase()}`);
  console.log(`${'='.repeat(60)}`);

  const hasApiKey = !!process.env.GEMINI_API_KEY;
  const hasOAuth =
    !!process.env.GEMINI_OAUTH_CLIENT_ID &&
    !!process.env.GEMINI_OAUTH_CLIENT_SECRET;

  if (!hasApiKey && !hasOAuth) {
    return {
      client,
      success: false,
      duration: 0,
      error: 'Neither GEMINI_API_KEY nor GEMINI_OAUTH_* credentials set',
    };
  }

  const config = loadConfig();
  const start = Date.now();

  try {
    console.log(`Query: "${TEST_QUERY}"`);
    console.log(`Model: ${config.gemini.model}`);
    console.log(`Auth method: ${config.gemini.authMethod}`);
    console.log(`Search enabled: ${config.gemini.searchEnabled}`);
    console.log('Executing...');

    const result: SearchResult = await searchGemini(TEST_QUERY, config.gemini);
    const duration = Date.now() - start;

    if (result.success) {
      console.log(`\n✅ SUCCESS (${duration}ms)`);
      console.log(`Content length: ${result.content?.length || 0} chars`);
      console.log(`Citations: ${result.citations?.length || 0}`);

      if (result.citations && result.citations.length > 0) {
        console.log('\nCitations found:');
        result.citations.slice(0, 5).forEach((url, i) => {
          console.log(`  [${i + 1}] ${url}`);
        });
      }

      console.log('\nContent preview:');
      console.log(`${result.content?.slice(0, 500)}...`);

      return {
        client,
        success: true,
        duration,
        contentLength: result.content?.length,
        citationCount: result.citations?.length,
        preview: result.content?.slice(0, 200),
        citations: result.citations,
      };
    } else {
      console.log(`\n❌ FAILED: ${result.error}`);
      return {
        client,
        success: false,
        duration,
        error: result.error,
      };
    }
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(`\n❌ EXCEPTION: ${errorMsg}`);
    return {
      client,
      success: false,
      duration,
      error: errorMsg,
    };
  }
}

async function testGrok(): Promise<TestResult> {
  const client = 'grok';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${client.toUpperCase()}`);
  console.log(`${'='.repeat(60)}`);

  if (!process.env.GROK_API_KEY && !process.env.GROKAI_API_KEY) {
    return {
      client,
      success: false,
      duration: 0,
      error: 'Neither GROK_API_KEY nor GROKAI_API_KEY set',
    };
  }

  const config = loadConfig();
  const start = Date.now();

  try {
    console.log(`Query: "${TEST_QUERY}"`);
    console.log(`Model: ${config.grok.model}`);
    console.log(`Search enabled: ${config.grok.searchEnabled}`);
    console.log('Executing...');

    const result: SearchResult = await grokSearch(TEST_QUERY, config.grok);
    const duration = Date.now() - start;

    if (result.success) {
      console.log(`\n✅ SUCCESS (${duration}ms)`);
      console.log(`Content length: ${result.content?.length || 0} chars`);
      console.log(`Citations: ${result.citations?.length || 0}`);

      if (result.citations && result.citations.length > 0) {
        console.log('\nCitations found:');
        result.citations.slice(0, 5).forEach((url, i) => {
          console.log(`  [${i + 1}] ${url}`);
        });
      }

      console.log('\nContent preview:');
      console.log(`${result.content?.slice(0, 500)}...`);

      return {
        client,
        success: true,
        duration,
        contentLength: result.content?.length,
        citationCount: result.citations?.length,
        preview: result.content?.slice(0, 200),
        citations: result.citations,
      };
    } else {
      console.log(`\n❌ FAILED: ${result.error}`);
      return {
        client,
        success: false,
        duration,
        error: result.error,
      };
    }
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(`\n❌ EXCEPTION: ${errorMsg}`);
    return {
      client,
      success: false,
      duration,
      error: errorMsg,
    };
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const target = args[0]?.toLowerCase() || 'all';

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       Research Shell API Client Tests                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nTest target: ${target}`);
  console.log(`Test query: "${TEST_QUERY}"`);

  const results: TestResult[] = [];

  if (target === 'all' || target === 'perplexity') {
    results.push(await testPerplexity());
  }

  if (target === 'all' || target === 'gemini') {
    results.push(await testGemini());
  }

  if (target === 'all' || target === 'grok') {
    results.push(await testGrok());
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(60)}`);

  const passed = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(
    `\nTotal: ${results.length} | Passed: ${passed.length} | Failed: ${failed.length}`,
  );

  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    const details = result.success
      ? `${result.duration}ms, ${result.contentLength} chars, ${result.citationCount} citations`
      : result.error;
    console.log(`  ${status} ${result.client}: ${details}`);
  }

  // Exit with error code if one or more failed
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
