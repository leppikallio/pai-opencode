#!/usr/bin/env bun
/**
 * PromptClassifier.ts
 *
 * Fast, optional pass-1 prompt classification for OpenCode-only PAI.
 *
 * - Uses `openai/gpt-5.2` when OPENAI_API_KEY is present.
 * - Falls back to deterministic heuristics when missing.
 *
 * Output: JSON to stdout.
 */

import { inference } from './Inference';

export type PromptDepth = 'MINIMAL' | 'ITERATION' | 'FULL';
export type ReasoningProfile = 'light' | 'standard' | 'deep';
export type Verbosity = 'minimal' | 'standard' | 'detailed';

export type PromptHint = {
  v: '0.1';
  depth: PromptDepth;
  reasoning_profile: ReasoningProfile;
  verbosity: Verbosity;
  capabilities: string[];
  thinking_tools: string[];
  confidence: number;
  source: 'openai' | 'heuristic';
};

function usage(): string {
  return [
    'Usage:',
    '  bun PromptClassifier.ts "<user prompt>"',
    '',
    'Notes:',
    '  - If OPENAI_API_KEY is missing, uses heuristics.',
    '  - Designed for quick pass-1 hints only.',
  ].join('\n');
}

function isGreeting(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === 'hi' || t === 'hello' || t === 'hey' || t.startsWith('hello ') || t.startsWith('hi ');
}

function heuristic(prompt: string): PromptHint {
  const p = prompt.trim();
  const lower = p.toLowerCase();

  let depth: PromptDepth = 'FULL';
  if (p.length <= 40 && isGreeting(p)) depth = 'MINIMAL';
  else if (/\b(continue|please continue|next step|keep going)\b/i.test(p)) depth = 'ITERATION';

  let reasoning_profile: ReasoningProfile = 'standard';
  if (depth === 'MINIMAL') reasoning_profile = 'light';
  if (/\b(thorough|very thorough|deep|architecture|design doc|system design)\b/i.test(p)) reasoning_profile = 'deep';

  let verbosity: Verbosity = 'standard';
  if (depth === 'MINIMAL') verbosity = 'minimal';
  if (/\b(detailed|very detailed|exhaustive)\b/i.test(p)) verbosity = 'detailed';

  const capabilities: string[] = [];
  if (/\b(ui|ux|design|layout)\b/i.test(lower)) capabilities.push('Designer');
  if (/\b(test|tests|qa|verify)\b/i.test(lower)) capabilities.push('QATester');
  if (/\b(security|pentest|vuln|threat model)\b/i.test(lower)) capabilities.push('Pentester');
  if (/\b(research|sources|citations)\b/i.test(lower)) capabilities.push('researcher');
  if (/\b(implement|fix|refactor|code)\b/i.test(lower)) capabilities.push('Engineer');
  if (capabilities.length === 0) capabilities.push('Engineer');

  const thinking_tools: string[] = [];
  if (depth === 'FULL') {
    thinking_tools.push('FirstPrinciples', 'RedTeam');
    if (/\b(options|ideas|brainstorm)\b/i.test(lower)) thinking_tools.push('BeCreative');
  }

  return {
    v: '0.1',
    depth,
    reasoning_profile,
    verbosity,
    capabilities,
    thinking_tools,
    confidence: 0.55,
    source: 'heuristic',
  };
}

async function openAiClassify(prompt: string): Promise<PromptHint> {
  const systemPrompt = [
    'You are a classifier for an OpenCode-based Personal AI Infrastructure.',
    'Return ONLY valid JSON that matches this schema:',
    '{',
    '  "v": "0.1",',
    '  "depth": "MINIMAL"|"ITERATION"|"FULL",',
    '  "reasoning_profile": "light"|"standard"|"deep",',
    '  "verbosity": "minimal"|"standard"|"detailed",',
    '  "capabilities": ["Engineer"|"Designer"|"QATester"|"Pentester"|"researcher"|"Explore"],',
    '  "thinking_tools": ["FirstPrinciples"|"RedTeam"|"BeCreative"|"Council"|"Research"|"Evals"],',
    '  "confidence": 0.0,',
    '  "source": "openai"',
    '}',
    '',
    'Use conservative defaults when uncertain.',
  ].join('\n');

  const result = await inference({
    systemPrompt,
    userPrompt: prompt,
    level: 'fast',
    expectJson: true,
    timeout: 2000,
    model: 'openai/gpt-5.2',
  });

  if (!result.success || !result.parsed || typeof result.parsed !== 'object') {
    return heuristic(prompt);
  }

  const obj = result.parsed as Record<string, unknown>;
  const out: PromptHint = {
    v: '0.1',
    depth: (obj.depth as PromptDepth) || 'FULL',
    reasoning_profile: (obj.reasoning_profile as ReasoningProfile) || 'standard',
    verbosity: (obj.verbosity as Verbosity) || 'standard',
    capabilities: Array.isArray(obj.capabilities) ? (obj.capabilities as string[]) : ['Engineer'],
    thinking_tools: Array.isArray(obj.thinking_tools) ? (obj.thinking_tools as string[]) : [],
    confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.6,
    source: 'openai',
  };
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return;
  }

  const prompt = args.join(' ').trim();
  if (!prompt) {
    console.error(usage());
    process.exit(1);
  }

  // NOTE: inference() can run via OpenCode carrier without OPENAI_API_KEY.
  const hint = await openAiClassify(prompt);

  console.log(JSON.stringify(hint));
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
