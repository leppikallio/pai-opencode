/**
 * Markdown to DOCX conversion module
 * Converts parsed markdown tokens to docx elements
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  ExternalHyperlink,
  HeadingLevel,
  type IParagraphOptions,
  ImageRun,
  InternalHyperlink,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { type Token, type Tokens, marked } from 'marked';
import type { ExtractedTemplate } from './DocxCliTemplate.ts';

export interface ConversionOptions {
  /** Base path for resolving relative image paths */
  basePath?: string;
  /** Maximum image width in EMUs (default: 6 inches = 5486400 EMUs) */
  maxImageWidth?: number;
  /** Template for style references */
  template?: ExtractedTemplate;
}

export type DocxElement = Paragraph | Table;

// Map to store heading slugs to their bookmark IDs for internal linking
const headingBookmarks = new Map<string, string>();

/**
 * Reset heading bookmarks map (call before each document generation)
 */
export function resetBookmarkCounter(): void {
  headingBookmarks.clear();
}

/**
 * Convert markdown string to array of docx elements
 */
export async function markdownToDocx(
  markdown: string,
  options: ConversionOptions = {}
): Promise<DocxElement[]> {
  const tokens = marked.lexer(markdown);
  const elements: DocxElement[] = [];

  for (const token of tokens) {
    const converted = await convertToken(token, options);
    if (converted) {
      if (Array.isArray(converted)) {
        elements.push(...converted);
      } else {
        elements.push(converted);
      }
    }
  }

  return elements;
}

/**
 * Convert a single markdown token to docx element(s)
 */
async function convertToken(
  token: Token,
  options: ConversionOptions
): Promise<DocxElement | DocxElement[] | null> {
  switch (token.type) {
    case 'heading':
      return convertHeading(token as Tokens.Heading, options);

    case 'paragraph':
      return convertParagraph(token as Tokens.Paragraph, options);

    case 'list':
      return convertList(token as Tokens.List, options);

    case 'blockquote':
      return convertBlockquote(token as Tokens.Blockquote, options);

    case 'code':
      return convertCodeBlock(token as Tokens.Code);

    case 'table':
      return convertTable(token as Tokens.Table, options);

    case 'hr':
      return convertHorizontalRule();

    case 'space':
      return null; // Skip empty space tokens

    case 'html':
      // Skip raw HTML - could add handling later
      return null;

    default:
      console.warn(`Unhandled token type: ${token.type}`);
      return null;
  }
}

/**
 * Convert heading to Paragraph with heading style and bookmark anchor
 * Professional pagination: Headings always keep with next paragraph
 * Alignment: Left-align headings (not justified)
 */
function convertHeading(token: Tokens.Heading, options: ConversionOptions): Paragraph {
  const level = Math.min(token.depth, 6) as 1 | 2 | 3 | 4 | 5 | 6;

  // Map level to HeadingLevel enum
  const headingLevelMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };

  // Generate a slug for the bookmark (same logic markdown uses for anchors)
  const slug = generateSlug(token.text);

  // Store the bookmark ID for internal linking
  // Use the slug as both the lookup key and the bookmark ID
  headingBookmarks.set(slug, slug);

  // Create bookmark with heading text inside
  const headingChildren = convertInlineTokens(token.tokens || [], options);

  const paragraphOptions: IParagraphOptions = {
    heading: headingLevelMap[level],
    // ALIGNMENT: Left-align headings (override template's justified default)
    alignment: AlignmentType.LEFT,
    // PAGINATION: Headings should never be orphaned at page bottom
    keepNext: true,
    // PAGINATION: H1 headings start on new page (major sections)
    pageBreakBefore: level === 1,
    children: [
      // Add bookmark that wraps the heading content
      new Bookmark({
        id: slug,
        children: headingChildren
          .map((child) => {
            // Bookmarks only accept TextRun children, not hyperlinks
            if (child instanceof TextRun) {
              return child;
            }
            // For non-TextRun items, extract text representation
            return new TextRun({ text: '' });
          })
          .filter((c): c is TextRun => c instanceof TextRun),
      }),
    ],
  };

  return new Paragraph(paragraphOptions);
}

/**
 * Generate a URL-friendly slug from heading text (same as markdown anchor generation)
 */
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .trim();
}

/**
 * Convert paragraph to Paragraph element
 * Professional pagination: Enable widow/orphan control
 * Alignment: Left-align (not justified) for better readability
 */
function convertParagraph(
  token: Tokens.Paragraph,
  options: ConversionOptions
): Paragraph | Paragraph[] {
  // Check for image-only paragraphs
  if (token.tokens?.length === 1 && token.tokens[0]?.type === 'image') {
    const imageToken = token.tokens[0] as Tokens.Image;
    const imageRun = createImageRun(imageToken, options);
    if (imageRun) {
      return new Paragraph({
        children: [imageRun],
        alignment: AlignmentType.CENTER,
        // PAGINATION: Don't split image from its context
        keepNext: true,
      });
    }
  }

  return new Paragraph({
    children: convertInlineTokens(token.tokens || [], options),
    // ALIGNMENT: Left-align text (override template's justified default)
    alignment: AlignmentType.LEFT,
    // PAGINATION: Prevent single lines at top/bottom of pages
    widowControl: true,
  });
}

/**
 * Convert list to array of Paragraph elements with bullet/number styling
 */
function convertList(token: Tokens.List, options: ConversionOptions): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const isOrdered = token.ordered;

  for (let i = 0; i < token.items.length; i++) {
    const item = token.items[i];
    if (item) {
      const itemParagraphs = convertListItem(item, isOrdered, i, options);
      paragraphs.push(...itemParagraphs);
    }
  }

  return paragraphs;
}

/**
 * Convert a single list item
 */
function convertListItem(
  item: Tokens.ListItem,
  isOrdered: boolean,
  _index: number,
  options: ConversionOptions
): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // List item tokens typically contain 'text' or 'paragraph' tokens
  // We need to extract the actual inline content
  const inlineTokens: Token[] = [];

  for (const token of item.tokens || []) {
    if (token.type === 'text') {
      // For text tokens, the inline tokens are in token.tokens
      const textToken = token as Tokens.Text & { tokens?: Token[] };
      if (textToken.tokens) {
        inlineTokens.push(...textToken.tokens);
      } else {
        inlineTokens.push(token);
      }
    } else if (token.type === 'paragraph') {
      // For paragraph tokens, extract its inline tokens
      inlineTokens.push(...((token as Tokens.Paragraph).tokens || []));
    } else {
      // For other types, try to use them directly
      inlineTokens.push(token);
    }
  }

  // First paragraph with bullet/number
  // PAGINATION: List items should stay together with their content
  const firstPara = new Paragraph({
    bullet: isOrdered ? undefined : { level: 0 },
    numbering: isOrdered ? { reference: 'default-numbering', level: 0 } : undefined,
    // ALIGNMENT: Left-align list items
    alignment: AlignmentType.LEFT,
    widowControl: true,
    children: convertInlineTokens(inlineTokens, options),
  });
  paragraphs.push(firstPara);

  return paragraphs;
}

/**
 * Convert blockquote to styled Paragraph
 * Professional pagination: Keep quotes together
 * Alignment: Left-align quotes
 */
function convertBlockquote(token: Tokens.Blockquote, options: ConversionOptions): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  for (const innerToken of token.tokens || []) {
    if (innerToken.type === 'paragraph') {
      paragraphs.push(
        new Paragraph({
          style: 'Quote',
          indent: { left: 720 }, // 0.5 inch indent
          // ALIGNMENT: Left-align quotes
          alignment: AlignmentType.LEFT,
          // PAGINATION: Quotes should stay together
          keepLines: true,
          widowControl: true,
          children: convertInlineTokens((innerToken as Tokens.Paragraph).tokens || [], options),
        })
      );
    }
  }

  return paragraphs;
}

/**
 * Convert code block to styled Paragraph
 * Professional pagination: Keep code blocks together on same page
 * Alignment: Left-align code
 */
function convertCodeBlock(token: Tokens.Code): Paragraph {
  return new Paragraph({
    style: 'Code',
    shading: { fill: 'F5F5F5' },
    // ALIGNMENT: Left-align code blocks
    alignment: AlignmentType.LEFT,
    // PAGINATION: Code blocks should not be split across pages
    keepLines: true,
    widowControl: true,
    children: [
      new TextRun({
        text: token.text,
        font: 'Consolas',
        size: 20, // 10pt
      }),
    ],
  });
}

/**
 * Convert table to Table element
 * Professional pagination: Rows don't split across pages, headers repeat
 * Alignment: Left-align table cell content
 */
function convertTable(token: Tokens.Table, options: ConversionOptions): Table {
  const rows: TableRow[] = [];

  // Header row
  if (token.header && token.header.length > 0) {
    const headerCells = token.header.map(
      (cell: Tokens.TableCell) =>
        new TableCell({
          children: [
            new Paragraph({
              // ALIGNMENT: Left-align table headers
              alignment: AlignmentType.LEFT,
              children: convertInlineTokens(cell.tokens || [], options),
            }),
          ],
          shading: { fill: 'E0E0E0' },
        })
    );
    // PAGINATION: Header row repeats on each page and can't split
    rows.push(new TableRow({ children: headerCells, tableHeader: true, cantSplit: true }));
  }

  // Data rows
  for (const row of token.rows || []) {
    const cells = row.map(
      (cell: Tokens.TableCell) =>
        new TableCell({
          children: [
            new Paragraph({
              // ALIGNMENT: Left-align table cell content
              alignment: AlignmentType.LEFT,
              children: convertInlineTokens(cell.tokens || [], options),
            }),
          ],
        })
    );
    // PAGINATION: Data rows should not be split across pages
    rows.push(new TableRow({ children: cells, cantSplit: true }));
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, size: 1 },
    },
  });
}

/**
 * Convert horizontal rule to thematic break (visual separator)
 * Note: Major section breaks are now handled by H1 headings with pageBreakBefore
 * Use "---\n\n# Heading" if you want a page break before a section
 * Use "---" alone for a visual separator without page break
 */
function convertHorizontalRule(): Paragraph {
  return new Paragraph({
    thematicBreak: true,
    spacing: { before: 400, after: 400 }, // ~0.3 inch spacing around the line
    children: [],
  });
}

type InlineElement = TextRun | ImageRun | ExternalHyperlink | InternalHyperlink | Bookmark;

/**
 * Convert inline tokens to TextRun/ImageRun array
 */
function convertInlineTokens(tokens: Token[], options: ConversionOptions): InlineElement[] {
  const runs: InlineElement[] = [];

  for (const token of tokens) {
    const converted = convertInlineToken(token, options);
    if (converted) {
      if (Array.isArray(converted)) {
        runs.push(...converted);
      } else {
        runs.push(converted);
      }
    }
  }

  return runs;
}

/**
 * Helper to convert styled tokens (bold, italic) by applying styles to all nested text
 */
function convertStyledTokens(
  tokens: Token[],
  style: { bold?: boolean; italics?: boolean },
  options: ConversionOptions
): TextRun[] {
  const runs: TextRun[] = [];

  for (const token of tokens) {
    if (token.type === 'text') {
      runs.push(
        new TextRun({
          text: (token as Tokens.Text).text,
          ...style,
        })
      );
    } else if (token.type === 'strong') {
      // Nested bold inside italic or vice versa
      runs.push(
        ...convertStyledTokens(
          (token as Tokens.Strong).tokens || [],
          { ...style, bold: true },
          options
        )
      );
    } else if (token.type === 'em') {
      runs.push(
        ...convertStyledTokens(
          (token as Tokens.Em).tokens || [],
          { ...style, italics: true },
          options
        )
      );
    } else if (token.type === 'codespan') {
      runs.push(
        new TextRun({
          text: (token as Tokens.Codespan).text,
          font: 'Consolas',
          ...style,
        })
      );
    } else if ('text' in token && typeof token.text === 'string') {
      runs.push(
        new TextRun({
          text: token.text,
          ...style,
        })
      );
    } else if ('raw' in token && typeof token.raw === 'string') {
      runs.push(
        new TextRun({
          text: token.raw,
          ...style,
        })
      );
    }
  }

  return runs;
}

/**
 * Convert a single inline token
 */
function convertInlineToken(
  token: Token,
  options: ConversionOptions
): InlineElement | InlineElement[] | null {
  switch (token.type) {
    case 'text':
      return new TextRun({ text: (token as Tokens.Text).text });

    case 'strong':
      // Recursively convert inner tokens and apply bold styling
      return convertStyledTokens((token as Tokens.Strong).tokens || [], { bold: true }, options);

    case 'em':
      // Recursively convert inner tokens and apply italic styling
      return convertStyledTokens((token as Tokens.Em).tokens || [], { italics: true }, options);

    case 'codespan':
      return new TextRun({
        text: (token as Tokens.Codespan).text,
        font: 'Consolas',
        shading: { fill: 'F5F5F5' },
      });

    case 'link': {
      const linkToken = token as Tokens.Link;
      const href = linkToken.href;

      // Check if this is an internal link (starts with #)
      if (href.startsWith('#')) {
        // Internal bookmark link
        const anchor = href.slice(1); // Remove the #
        return new InternalHyperlink({
          anchor: anchor,
          children: [
            new TextRun({
              text: linkToken.text,
              style: 'Hyperlink',
            }),
          ],
        });
      }
      // External link
      return new ExternalHyperlink({
        link: href,
        children: [
          new TextRun({
            text: linkToken.text,
            style: 'Hyperlink',
          }),
        ],
      });
    }

    case 'image':
      return createImageRun(token as Tokens.Image, options);

    case 'br':
      return new TextRun({ break: 1 });

    case 'escape':
      return new TextRun({ text: (token as Tokens.Escape).text });

    default:
      // For unrecognized tokens with raw text
      if ('raw' in token && typeof token.raw === 'string') {
        return new TextRun({ text: token.raw });
      }
      return null;
  }
}

/**
 * Create ImageRun from image token
 */
function createImageRun(token: Tokens.Image, options: ConversionOptions): ImageRun | null {
  const { basePath = process.cwd(), maxImageWidth = 5486400 } = options;

  let imagePath = token.href;

  // Handle relative paths
  if (!path.isAbsolute(imagePath) && !imagePath.startsWith('http')) {
    imagePath = path.resolve(basePath, imagePath);
  }

  // Handle URLs - skip for now (would need fetch)
  if (imagePath.startsWith('http')) {
    console.warn(`Skipping remote image: ${imagePath}`);
    return null;
  }

  // Resolve ~ to home directory
  imagePath = imagePath.replace(/^~/, process.env.HOME || '');

  if (!fs.existsSync(imagePath)) {
    console.warn(`Image not found: ${imagePath}`);
    return null;
  }

  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const dimensions = getImageDimensions(imagePath);

    // Calculate dimensions maintaining aspect ratio
    let width = dimensions.width;
    let height = dimensions.height;

    // Convert to EMUs (914400 EMUs per inch, assume 96 DPI for pixels)
    const pixelToEmu = 914400 / 96;
    width = Math.round(width * pixelToEmu);
    height = Math.round(height * pixelToEmu);

    // Scale down if wider than max
    if (width > maxImageWidth) {
      const scale = maxImageWidth / width;
      width = maxImageWidth;
      height = Math.round(height * scale);
    }

    return new ImageRun({
      data: imageBuffer,
      transformation: { width, height },
      type: getImageType(imagePath),
    });
  } catch (error) {
    console.warn(`Failed to load image ${imagePath}:`, error);
    return null;
  }
}

/**
 * Get image dimensions (basic implementation)
 */
function getImageDimensions(imagePath: string): { width: number; height: number } {
  const buffer = fs.readFileSync(imagePath);

  // PNG: dimensions at bytes 16-24
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  // JPEG: more complex, scan for SOF0/SOF2 marker
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      const length = buffer.readUInt16BE(offset + 2);
      offset += 2 + length;
    }
  }

  // GIF: dimensions at bytes 6-10
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    };
  }

  // Default fallback
  return { width: 400, height: 300 };
}

/**
 * Get image type from path
 */
function getImageType(imagePath: string): 'jpg' | 'png' | 'gif' | 'bmp' {
  const ext = path.extname(imagePath).toLowerCase();
  const types: Record<string, 'jpg' | 'png' | 'gif' | 'bmp'> = {
    '.jpg': 'jpg',
    '.jpeg': 'jpg',
    '.png': 'png',
    '.gif': 'gif',
    '.bmp': 'bmp',
  };
  return types[ext] || 'png';
}
