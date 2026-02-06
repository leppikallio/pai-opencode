/**
 * Template extraction module
 * Extracts styles, headers, footers, and settings from .dotx templates
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import PizZip from 'pizzip';

export interface TemplateStyle {
  id: string;
  name: string;
  type: 'paragraph' | 'character' | 'table' | 'numbering';
  basedOn?: string;
}

export interface TemplateMedia {
  filename: string;
  data: Buffer;
  contentType: string;
}

export interface ExtractedTemplate {
  /** Raw styles.xml content */
  stylesXml: string;
  /** Raw numbering.xml content (for lists) */
  numberingXml: string | null;
  /** Raw settings.xml content */
  settingsXml: string;
  /** Header XML files */
  headers: Map<string, string>;
  /** Footer XML files */
  footers: Map<string, string>;
  /** Media files (images) */
  media: Map<string, TemplateMedia>;
  /** Relationships */
  relationships: {
    document: string;
    headers: Map<string, string>;
  };
  /** Parsed style metadata */
  styles: TemplateStyle[];
  /** Theme XML */
  themeXml: string | null;
}

/**
 * Load and parse a .dotx template file
 */
export async function loadTemplate(templatePath: string): Promise<ExtractedTemplate> {
  const resolvedPath = templatePath.replace(/^~/, process.env.HOME || '');

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Template not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath);
  const zip = new PizZip(content);

  // Extract styles.xml
  const stylesXml = extractFile(zip, 'word/styles.xml');
  if (!stylesXml) {
    throw new Error('Template missing styles.xml');
  }

  // Extract numbering.xml (for list styles)
  const numberingXml = extractFile(zip, 'word/numbering.xml');

  // Extract settings.xml
  const settingsXml = extractFile(zip, 'word/settings.xml') || '';

  // Extract theme
  const themeXml = extractFile(zip, 'word/theme/theme1.xml');

  // Extract headers
  const headers = new Map<string, string>();
  for (let i = 1; i <= 10; i++) {
    const headerXml = extractFile(zip, `word/header${i}.xml`);
    if (headerXml) {
      headers.set(`header${i}.xml`, headerXml);
    }
  }

  // Extract footers
  const footers = new Map<string, string>();
  for (let i = 1; i <= 10; i++) {
    const footerXml = extractFile(zip, `word/footer${i}.xml`);
    if (footerXml) {
      footers.set(`footer${i}.xml`, footerXml);
    }
  }

  // Extract media files
  const media = new Map<string, TemplateMedia>();
  const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith('word/media/'));
  for (const mediaPath of mediaFiles) {
    const filename = path.basename(mediaPath);
    const data = zip.file(mediaPath)?.asNodeBuffer();
    if (data) {
      media.set(filename, {
        filename,
        data,
        contentType: getMediaContentType(filename),
      });
    }
  }

  // Extract relationships
  const documentRels = extractFile(zip, 'word/_rels/document.xml.rels') || '';
  const headerRels = new Map<string, string>();
  for (let i = 1; i <= 10; i++) {
    const rels = extractFile(zip, `word/_rels/header${i}.xml.rels`);
    if (rels) {
      headerRels.set(`header${i}.xml.rels`, rels);
    }
  }

  // Parse style metadata
  const styles = parseStyles(stylesXml);

  return {
    stylesXml,
    numberingXml,
    settingsXml,
    headers,
    footers,
    media,
    relationships: {
      document: documentRels,
      headers: headerRels,
    },
    styles,
    themeXml,
  };
}

/**
 * Extract a file from the zip archive
 */
function extractFile(zip: PizZip, filePath: string): string | null {
  const file = zip.file(filePath);
  if (!file) return null;
  return file.asText();
}

/**
 * Determine content type from filename
 */
function getMediaContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.emf': 'image/x-emf',
    '.wmf': 'image/x-wmf',
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * Parse style definitions from styles.xml
 */
function parseStyles(stylesXml: string): TemplateStyle[] {
  const styles: TemplateStyle[] = [];

  // Simple regex-based parsing for style metadata
  // Match: <w:style w:type="paragraph" w:styleId="Heading1">
  const styleRegex = /<w:style[^>]*w:type="([^"]*)"[^>]*w:styleId="([^"]*)"[^>]*>/g;
  const nameRegex = /<w:name[^>]*w:val="([^"]*)"/;
  const basedOnRegex = /<w:basedOn[^>]*w:val="([^"]*)"/;

  let match: RegExpExecArray | null = styleRegex.exec(stylesXml);
  while (match !== null) {
    const type = match[1];
    const id = match[2];

    // Skip if we didn't capture both groups
    if (!type || !id) {
      match = styleRegex.exec(stylesXml);
      continue;
    }

    // Find the closing tag to get the full style definition
    const startIndex = match.index;
    const endIndex = stylesXml.indexOf('</w:style>', startIndex);
    if (endIndex === -1) {
      match = styleRegex.exec(stylesXml);
      continue;
    }

    const styleContent = stylesXml.slice(startIndex, endIndex);

    const nameMatch = nameRegex.exec(styleContent);
    const basedOnMatch = basedOnRegex.exec(styleContent);

    styles.push({
      id,
      name: nameMatch?.[1] ?? id,
      type: type as TemplateStyle['type'],
      basedOn: basedOnMatch?.[1],
    });
    match = styleRegex.exec(stylesXml);
  }

  return styles;
}

/**
 * List available styles in a template (for CLI styles command)
 */
export function listStyles(template: ExtractedTemplate): string {
  const output: string[] = [];

  output.push('=== Paragraph Styles ===');
  const paragraphStyles = template.styles.filter((s) => s.type === 'paragraph');
  for (const style of paragraphStyles) {
    const basedOn = style.basedOn ? ` (based on: ${style.basedOn})` : '';
    output.push(`  ${style.id}: ${style.name}${basedOn}`);
  }

  output.push('\n=== Character Styles ===');
  const charStyles = template.styles.filter((s) => s.type === 'character');
  for (const style of charStyles) {
    output.push(`  ${style.id}: ${style.name}`);
  }

  output.push('\n=== Table Styles ===');
  const tableStyles = template.styles.filter((s) => s.type === 'table');
  for (const style of tableStyles) {
    output.push(`  ${style.id}: ${style.name}`);
  }

  output.push('\n=== Headers/Footers ===');
  output.push(`  Headers: ${template.headers.size}`);
  output.push(`  Footers: ${template.footers.size}`);

  output.push('\n=== Media Files ===');
  for (const [filename] of template.media) {
    output.push(`  ${filename}`);
  }

  return output.join('\n');
}

/**
 * Get the style ID for a heading level
 */
export function getHeadingStyleId(template: ExtractedTemplate, level: number): string {
  const style = template.styles.find(
    (s) => s.id === `Heading${level}` || s.name === `heading ${level}`
  );
  return style?.id || `Heading${level}`;
}

/**
 * Check if template has a specific style
 */
export function hasStyle(template: ExtractedTemplate, styleId: string): boolean {
  return template.styles.some((s) => s.id === styleId || s.name === styleId);
}
