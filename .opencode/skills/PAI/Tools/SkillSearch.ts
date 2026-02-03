#!/usr/bin/env bun
/**
 * SkillSearch.ts
 *
 * Search the skill index to discover capabilities dynamically.
 * Use this when you need to find which skill handles a specific task.
 *
 * Usage:
 *   bun run ~/.config/opencode/skills/PAI/Tools/SkillSearch.ts <query>
 *   bun run ~/.config/opencode/skills/PAI/Tools/SkillSearch.ts "scrape instagram"
 *   bun run ~/.config/opencode/skills/PAI/Tools/SkillSearch.ts --list           # List all skills
 *   bun run ~/.config/opencode/skills/PAI/Tools/SkillSearch.ts --tier always    # List always-loaded skills
 *   bun run ~/.config/opencode/skills/PAI/Tools/SkillSearch.ts --tier deferred  # List deferred skills
 *
 * Output: Matching skills with full descriptions and workflows
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { getSkillsDir } from '../../../pai-tools/PaiRuntime';

type Options = {
  indexFile: string;
};

function usage(opts?: Partial<Options>) {
  const skillsDir = getSkillsDir();
  const indexFile = opts?.indexFile || join(skillsDir, 'skill-index.json');
  console.log('SkillSearch.ts - Search skill-index.json for matching skills');
  console.log('');
  console.log('Usage:');
  console.log('  bun run ~/.config/opencode/skills/PAI/Tools/SkillSearch.ts <query>');
  console.log('  bun run ~/.config/opencode/skills/PAI/Tools/SkillSearch.ts --list');
  console.log('  bun run ~/.config/opencode/skills/PAI/Tools/SkillSearch.ts --tier always');
  console.log('');
  console.log('Options:');
  console.log('  --skills-dir <dir>   Override skills root (uses <dir>/skill-index.json)');
  console.log(`  --index <file>       Override index file (default: ${indexFile})`);
  console.log('  -h, --help           Show help');
}

function parseArgs(argv: string[]): { opts: Options; args: string[] } | null {
  let indexFile = join(getSkillsDir(), 'skill-index.json');
  const args: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return null;
    if (a === '--skills-dir') {
      const v = argv[i + 1];
      if (!v) throw new Error('Missing value for --skills-dir');
      indexFile = join(resolve(v), 'skill-index.json');
      i++;
      continue;
    }
    if (a === '--index') {
      const v = argv[i + 1];
      if (!v) throw new Error('Missing value for --index');
      indexFile = resolve(v);
      i++;
      continue;
    }
    args.push(a);
  }

  return { opts: { indexFile }, args };
}

interface SkillEntry {
  name: string;
  path: string;
  fullDescription: string;
  triggers: string[];
  workflows: string[];
  tier: 'always' | 'deferred';
}

interface SkillIndex {
  generated: string;
  totalSkills: number;
  alwaysLoadedCount: number;
  deferredCount: number;
  skills: Record<string, SkillEntry>;
}

interface SearchResult {
  skill: SkillEntry;
  score: number;
  matchedTriggers: string[];
}

function searchSkills(query: string, index: SkillIndex): SearchResult[] {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const results: SearchResult[] = [];

  for (const [key, skill] of Object.entries(index.skills)) {
    let score = 0;
    const matchedTriggers: string[] = [];

    // Check skill name
    if (key.includes(query.toLowerCase()) || skill.name.toLowerCase().includes(query.toLowerCase())) {
      score += 10;
    }

    // Check triggers
    for (const term of queryTerms) {
      for (const trigger of skill.triggers) {
        if (trigger.includes(term) || term.includes(trigger)) {
          score += 5;
          if (!matchedTriggers.includes(trigger)) {
            matchedTriggers.push(trigger);
          }
        }
      }
    }

    // Check description
    const descLower = skill.fullDescription.toLowerCase();
    for (const term of queryTerms) {
      if (descLower.includes(term)) {
        score += 2;
      }
    }

    // Check workflows
    for (const workflow of skill.workflows) {
      for (const term of queryTerms) {
        if (workflow.toLowerCase().includes(term)) {
          score += 3;
        }
      }
    }

    if (score > 0) {
      results.push({ skill, score, matchedTriggers });
    }
  }

  // Sort by score descending
  return results.sort((a, b) => b.score - a.score);
}

function formatResult(result: SearchResult): string {
  const { skill, score, matchedTriggers } = result;
  const tierIcon = skill.tier === 'always' ? '🔒' : '📦';

  let output = `\n${'─'.repeat(60)}\n`;
  output += `${tierIcon} **${skill.name}** (score: ${score})\n`;
  output += `${'─'.repeat(60)}\n\n`;

  output += `**Path:** ${skill.path}\n`;
  output += `**Tier:** ${skill.tier}\n\n`;

  output += `**Description:**\n${skill.fullDescription}\n\n`;

  if (matchedTriggers.length > 0) {
    output += `**Matched Triggers:** ${matchedTriggers.join(', ')}\n\n`;
  }

  if (skill.workflows.length > 0) {
    output += `**Workflows:** ${skill.workflows.join(', ')}\n\n`;
  }

  output += `**Invoke with:** Skill { skill: "${skill.name}" }\n`;

  return output;
}

function listSkills(index: SkillIndex, tier?: 'always' | 'deferred'): void {
  console.log(`\n📚 Skill Index (generated: ${index.generated})\n`);

  const skills = Object.values(index.skills)
    .filter(s => !tier || s.tier === tier)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (tier === 'always') {
    console.log('🔒 Always-Loaded Skills (full descriptions in context):\n');
  } else if (tier === 'deferred') {
    console.log('📦 Deferred Skills (minimal descriptions, search for details):\n');
  } else {
    console.log('All Skills:\n');
  }

  for (const skill of skills) {
    const tierIcon = skill.tier === 'always' ? '🔒' : '📦';
    const triggerPreview = skill.triggers.slice(0, 5).join(', ');
    console.log(`  ${tierIcon} ${skill.name.padEnd(20)} │ ${triggerPreview}`);
  }

  console.log(`\nTotal: ${skills.length} skills`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    usage();
    process.exit(0);
  }

  const { opts, args } = parsed;

  // Check if index exists
  if (!existsSync(opts.indexFile)) {
    console.error(`❌ Skill index not found: ${opts.indexFile}`);
    console.error('Run GenerateSkillIndex.ts first:');
    console.error('  bun run ~/.config/opencode/skills/PAI/Tools/GenerateSkillIndex.ts');
    process.exit(1);
  }

  const indexContent = await readFile(opts.indexFile, 'utf-8');
  const index: SkillIndex = JSON.parse(indexContent);

  // Handle flags
  if (args.includes('--list') || args.length === 0) {
    listSkills(index);
    return;
  }

  if (args.includes('--tier')) {
    const tierIndex = args.indexOf('--tier');
    const tier = args[tierIndex + 1] as 'always' | 'deferred';
    if (tier === 'always' || tier === 'deferred') {
      listSkills(index, tier);
    } else {
      console.error('Invalid tier. Use: always or deferred');
    }
    return;
  }

  // Search mode
  const query = args.join(' ');
  console.log(`\n🔍 Searching for: "${query}"\n`);

  const results = searchSkills(query, index);

  if (results.length === 0) {
    console.log('No matching skills found.\n');
    console.log('Try broader terms or run with --list to see all skills.');
    return;
  }

  // Show top 5 results
  const topResults = results.slice(0, 5);
  console.log(`Found ${results.length} matching skills. Showing top ${topResults.length}:\n`);

  for (const result of topResults) {
    console.log(formatResult(result));
  }

  if (results.length > 5) {
    console.log(`\n... and ${results.length - 5} more results.`);
  }
}

main().catch(console.error);
