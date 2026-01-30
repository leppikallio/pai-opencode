#!/usr/bin/env bun

/**
 * CreateUpdate.ts
 * Creates update documents with proper formatting in PAISYSTEMUPDATES
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getPaiDir } from "../../../pai-tools/PaiRuntime";

interface CreateUpdateArgs {
  type: 'session' | 'project' | 'learning';
  title: string;
  content: string;
  significance: 'minor' | 'standard' | 'major';
  tags?: string;
}

function parseArgs(): CreateUpdateArgs | null {
  const args = process.argv.slice(2);
  const parsed: Partial<CreateUpdateArgs> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--type':
        if (!next || !['session', 'project', 'learning'].includes(next)) {
          console.error('Error: --type must be one of: session, project, learning');
          return null;
        }
        parsed.type = next as CreateUpdateArgs['type'];
        i++;
        break;
      case '--title':
        if (!next) {
          console.error('Error: --title requires a value');
          return null;
        }
        parsed.title = next;
        i++;
        break;
      case '--content':
        if (!next) {
          console.error('Error: --content requires a value');
          return null;
        }
        parsed.content = next;
        i++;
        break;
      case '--significance':
        if (!next || !['minor', 'standard', 'major'].includes(next)) {
          console.error('Error: --significance must be one of: minor, standard, major');
          return null;
        }
        parsed.significance = next as CreateUpdateArgs['significance'];
        i++;
        break;
      case '--tags':
        if (!next) {
          console.error('Error: --tags requires a value');
          return null;
        }
        parsed.tags = next;
        i++;
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;
      default:
        console.error(`Error: Unknown argument: ${arg}`);
        return null;
    }
  }

  // Validate required fields
  if (!parsed.type || !parsed.title || !parsed.content || !parsed.significance) {
    console.error('Error: Missing required arguments');
    showHelp();
    return null;
  }

  return parsed as CreateUpdateArgs;
}

function showHelp(): void {
  console.log(`
Usage: bun run CreateUpdate.ts --type TYPE --title TITLE --content CONTENT --significance LEVEL [--tags TAGS]

Required Arguments:
  --type           Update type (session|project|learning)
  --title          Update title
  --content        Update content
  --significance   Significance level (minor|standard|major)

Optional Arguments:
  --tags           Comma-separated tags

Options:
  -h, --help       Show this help message

Example:
  bun run CreateUpdate.ts --type session --title "Hook Development" --content "Created new hooks" --significance standard --tags "session,hooks"
`);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function createUpdate(args: CreateUpdateArgs): Promise<void> {
  const paiDir = getPaiDir();

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0];

  const slug = slugify(args.title);
  const filename = `${timestamp}_${args.type}_${slug}.md`;
  const dirPath = path.join(paiDir, "MEMORY", "PAISYSTEMUPDATES", String(year), month);
  const filePath = path.join(dirPath, filename);

  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    console.error(`Error: Failed to create directory ${dirPath}`);
    process.exit(1);
  }

  // Create update document
  const tags = (args.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const tagsLine = tags.length ? `tags: [${tags.join(", ")}]
` : "";

  const content = `---
type: ${args.type}
title: ${args.title}
timestamp: ${now.toISOString()}
significance: ${args.significance}
${tagsLine}---

# ${args.title}

${args.content}

---

**Type**: ${args.type}
**Significance**: ${args.significance}
**Created**: ${now.toISOString()}
`;

  try {
    await Bun.write(filePath, content);
    console.log(`✓ Created update: ${filePath}`);
    console.log(`  Type: ${args.type}`);
    console.log(`  Significance: ${args.significance}`);
    console.log(`  Title: ${args.title}`);
  } catch (error) {
    console.error(`Error: Failed to write file ${filePath}`);
    console.error(error);
    process.exit(1);
  }
}

// Main execution
const args = parseArgs();
if (args) {
  await createUpdate(args);
}
