#!/usr/bin/env bun
/**
 * DocxCli - Convert Markdown to Word documents using company templates
 *
 * Usage:
 *   DocxCli create <markdown-file> -o <output.docx> [--template <template.dotx>]
 *   DocxCli edit <existing.docx> --append <markdown-file>
 *   DocxCli read <existing.docx> [-o <output.md>]
 *   DocxCli styles <template.dotx>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import {
  type DocumentMetadata,
  createDocument,
  createSimpleDocument,
  saveDocument,
} from './DocxCliDocument.ts';
import { appendToDocument, extractMarkdown } from './DocxCliEdit.ts';
import { listStyles, loadTemplate } from './DocxCliTemplate.ts';

const program = new Command();

// Default template path (fallback if not configured)
const DEFAULT_TEMPLATE = '~/doc_template.dotx';

// Settings path
const SETTINGS_PATH = path.join(process.env.HOME || '', '.config', 'opencode', 'settings.json');

interface DocxCliConfig {
  template?: string;
  outputDir?: string;
}

interface PaiSettings {
  docxCli?: DocxCliConfig;
}

interface CreateOptions {
  output: string;
  template?: string | boolean;
  meta?: string;
  title?: string;
  subtitle?: string;
  author?: string;
  date?: string;
  docVersion?: string;
  confidentiality?: string;
}

interface EditOptions {
  append?: string;
  output?: string;
}

interface ReadOptions {
  output?: string;
}

/**
 * Load docx-cli configuration from ~/.config/opencode/settings.json
 */
function loadConfig(): DocxCliConfig {
  const settingsPath = SETTINGS_PATH;

  if (fs.existsSync(settingsPath)) {
    try {
      const settings: PaiSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings.docxCli || {};
    } catch {
      return {};
    }
  }

  return {};
}

/**
 * Resolve template path with fallbacks
 * Priority: CLI arg > ~/.config/opencode/settings.json > default
 */
function resolveTemplatePath(templateArg?: string): string {
  const config = loadConfig();

  // Priority: CLI arg > config > default
  let templatePath = templateArg || config.template || DEFAULT_TEMPLATE;

  // Resolve ~ to home directory
  templatePath = templatePath.replace(/^~/, process.env.HOME || '');

  if (!fs.existsSync(templatePath)) {
    console.error(`Template not found: ${templatePath}`);
    process.exit(1);
  }

  return templatePath;
}

/**
 * Read input from file or stdin
 */
async function readInput(inputPath: string): Promise<string> {
  if (inputPath === '-') {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  const resolvedPath = inputPath.replace(/^~/, process.env.HOME || '');
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  return fs.readFileSync(resolvedPath, 'utf-8');
}

/**
 * Parse metadata from JSON file or return empty object
 */
function loadMetadata(metaPath?: string): DocumentMetadata {
  if (!metaPath) return {};

  const resolvedPath = metaPath.replace(/^~/, process.env.HOME || '');
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Metadata file not found: ${resolvedPath}`);
    process.exit(1);
  }

  try {
    return JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
  } catch (error) {
    console.error(`Failed to parse metadata file: ${error}`);
    process.exit(1);
  }
}

// Program configuration
program
  .name('docx-cli')
  .description('Convert Markdown to Word documents using company templates')
  .version('1.0.0');

// Create command
program
  .command('create <input>')
  .description('Create a Word document from Markdown')
  .option('-o, --output <path>', 'Output file path', 'output.docx')
  .option('-t, --template <path>', 'Template file (.dotx)')
  .option('-m, --meta <path>', 'JSON metadata file for cover page')
  .option('--title <title>', 'Document title')
  .option('--subtitle <subtitle>', 'Document subtitle')
  .option('--author <author>', 'Document author')
  .option('--date <date>', 'Document date')
  .option('--doc-version <version>', 'Document version')
  .option('--confidentiality <level>', 'Confidentiality level')
  .option('--no-template', 'Create without template styling')
  .action(async (input: string, options: CreateOptions) => {
    try {
      // Read markdown input
      const markdown = await readInput(input);

      // Build metadata from options
      const fileMetadata = loadMetadata(options.meta);
      const metadata: DocumentMetadata = {
        title: options.title || fileMetadata.title,
        subtitle: options.subtitle || fileMetadata.subtitle,
        author: options.author || fileMetadata.author,
        date: options.date || fileMetadata.date,
        version: options.docVersion || fileMetadata.version,
        confidentiality: options.confidentiality || fileMetadata.confidentiality,
      };

      // Determine base path for image resolution
      const basePath = input === '-' ? process.cwd() : path.dirname(path.resolve(input));

      let buffer: Buffer;

      if (options.template === false) {
        // Create without template
        console.error('Creating document without template...');
        buffer = await createSimpleDocument(markdown, metadata);
      } else {
        // Create with template
        const templatePath = resolveTemplatePath(
          typeof options.template === 'string' ? options.template : undefined
        );
        console.error(`Using template: ${templatePath}`);

        buffer = await createDocument({
          markdown,
          templatePath,
          metadata,
          basePath,
        });
      }

      // Save output
      const outputPath = options.output.replace(/^~/, process.env.HOME || '');
      await saveDocument(buffer, outputPath);

      console.error(`Created: ${outputPath}`);
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });

// Edit command
program
  .command('edit <document>')
  .description('Edit an existing Word document')
  .option('-a, --append <markdown>', 'Append markdown content')
  .option('-o, --output <path>', 'Output file path (default: overwrite input)')
  .action(async (document: string, options: EditOptions) => {
    try {
      const docPath = document.replace(/^~/, process.env.HOME || '');

      if (!fs.existsSync(docPath)) {
        console.error(`Document not found: ${docPath}`);
        process.exit(1);
      }

      if (!options.append) {
        console.error('No edit operation specified. Use --append <markdown-file>');
        process.exit(1);
      }

      // Read markdown to append
      const markdown = await readInput(options.append);
      const basePath =
        options.append === '-' ? process.cwd() : path.dirname(path.resolve(options.append));

      // Append to document
      const buffer = await appendToDocument(docPath, markdown, { basePath });

      // Save output
      const outputPath = (options.output || document).replace(/^~/, process.env.HOME || '');
      await saveDocument(buffer, outputPath);

      console.error(`Updated: ${outputPath}`);
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });

// Read command
program
  .command('read <document>')
  .description('Extract markdown from a Word document')
  .option('-o, --output <path>', 'Output markdown file path')
  .action((document: string, options: ReadOptions) => {
    try {
      const docPath = document.replace(/^~/, process.env.HOME || '');

      if (!fs.existsSync(docPath)) {
        console.error(`Document not found: ${docPath}`);
        process.exit(1);
      }

      const markdown = extractMarkdown(docPath);
      if (options.output) {
        const outputPath = options.output.replace(/^~/, process.env.HOME || '');
        fs.writeFileSync(outputPath, markdown);
        console.error(`Extracted: ${outputPath}`);
      } else {
        process.stdout.write(markdown);
      }
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });

// Styles command
program
  .command('styles <template>')
  .description('List available styles in a template')
  .action(async (template: string) => {
    try {
      const templatePath = template.replace(/^~/, process.env.HOME || '');

      if (!fs.existsSync(templatePath)) {
        console.error(`Template not found: ${templatePath}`);
        process.exit(1);
      }

      const extractedTemplate = await loadTemplate(templatePath);
      console.log(listStyles(extractedTemplate));
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });

// Help command with examples
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('  $ docx-cli create report.md -o report.docx');
  console.log(
    '  $ docx-cli create report.md -o report.docx --title "Q4 Report" --author "John Doe"'
  );
  console.log('  $ docx-cli create report.md -o report.docx --meta metadata.json');
  console.log('  $ echo "# Hello World" | docx-cli create - -o hello.docx');
  console.log('  $ docx-cli edit existing.docx --append additions.md');
  console.log('  $ docx-cli read report.docx -o report.md');
  console.log('  $ docx-cli styles ~/doc_template.dotx');
});

// Parse and run
program.parse();
