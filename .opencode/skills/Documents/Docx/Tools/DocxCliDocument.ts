/**
 * Document assembly module
 * Combines template styles with converted markdown content
 *
 * APPROACH: Use the .dotx template as the BASE document, preserving all
 * headers, footers, backgrounds, media, and styling. Only replace the
 * document body content with converted markdown.
 */

import * as fs from 'node:fs';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  type INumberingOptions,
  Packer,
  PageBreak,
  Paragraph,
  StyleLevel,
  TableOfContents,
  TextRun,
} from 'docx';
import PizZip from 'pizzip';
import { markdownToDocx } from './DocxCliMarkdown.ts';

export interface DocumentMetadata {
  title?: string;
  subtitle?: string;
  author?: string;
  date?: string;
  version?: string;
  confidentiality?: string;
}

export interface CreateDocumentOptions {
  /** Markdown content */
  markdown: string;
  /** Path to .dotx template */
  templatePath: string;
  /** Document metadata for cover page */
  metadata?: DocumentMetadata;
  /** Base path for resolving relative image paths */
  basePath?: string;
}

/**
 * Create a Word document from markdown using a template
 *
 * Strategy: Clone the .dotx template and replace its body content while
 * preserving all other elements (headers, footers, styles, media, etc.)
 */
export async function createDocument(options: CreateDocumentOptions): Promise<Buffer> {
  const { markdown, templatePath, metadata = {}, basePath } = options;

  // Load template as a ZIP archive (docx/dotx are just ZIP files)
  const templateBuffer = fs.readFileSync(templatePath.replace(/^~/, process.env.HOME || ''));
  const zip = new PizZip(templateBuffer);

  // Convert markdown to docx XML elements
  const contentElements = await markdownToDocx(markdown, { basePath });

  // Build cover page and TOC
  const coverPage = buildCoverPage(metadata);
  const toc = buildTableOfContents();

  // Create the content document using docx library
  // This gets us properly formatted XML for the content
  const contentDoc = new Document({
    sections: [
      {
        children: [
          ...coverPage,
          new Paragraph({ children: [new PageBreak()] }),
          toc,
          new Paragraph({ children: [new PageBreak()] }),
          ...contentElements,
        ],
      },
    ],
    numbering: buildNumberingConfig(),
  });

  // Get the content document as a buffer
  const contentBuffer = await Packer.toBuffer(contentDoc);
  const contentZip = new PizZip(contentBuffer);

  // Extract the body content from the generated document
  const generatedDocXml = contentZip.file('word/document.xml')?.asText();
  if (!generatedDocXml) {
    throw new Error('Failed to generate document XML');
  }

  // Extract just the <w:body> content from the generated document
  // BUT exclude the sectPr at the end - we want to keep the template's sectPr
  const bodyMatch = generatedDocXml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch || !bodyMatch[1]) {
    throw new Error('Failed to extract body content');
  }
  let newBodyContent = bodyMatch[1];

  // Remove the generated sectPr - we'll use the template's instead
  // The template's sectPr contains header/footer references
  newBodyContent = newBodyContent.replace(/<w:sectPr[^>]*>[\s\S]*?<\/w:sectPr>\s*$/, '');

  // Get the template's document.xml
  const templateDocXml = zip.file('word/document.xml')?.asText();
  if (!templateDocXml) {
    throw new Error('Template missing document.xml');
  }

  // Extract the template's sectPr (contains header/footer references, page settings)
  const templateSectPrMatch = templateDocXml.match(/<w:sectPr[^>]*>[\s\S]*?<\/w:sectPr>/);
  const templateSectPr = templateSectPrMatch ? templateSectPrMatch[0] : '';

  // Replace the body content in the template while preserving the sectPr
  // This preserves headers, footers, section properties, etc.
  const modifiedDocXml = templateDocXml.replace(
    /<w:body[^>]*>[\s\S]*<\/w:body>/,
    `<w:body>${newBodyContent}${templateSectPr}</w:body>`
  );

  // Update the document.xml in the template ZIP
  zip.file('word/document.xml', modifiedDocXml);

  // NOTE: We skip merging numbering.xml because:
  // 1. The template already has comprehensive bullet/numbering definitions
  // 2. Merging numbering XML is complex and prone to corruption
  // 3. The docx library's generated bullets reference "default-numbering" which
  //    we'll need to map to template numbering instead
  // For now, we rely on the template's existing numbering definitions

  // Merge relationships if needed (for hyperlinks, etc.)
  // This returns a mapping of old IDs to new IDs that we need to apply to document.xml
  const idMapping = mergeRelationships(zip, contentZip);

  // Apply ID mapping to document.xml (fix hyperlink references)
  if (idMapping.size > 0) {
    let currentDocXml = zip.file('word/document.xml')?.asText() || '';
    for (const [oldId, newId] of idMapping) {
      // Replace all occurrences of the old ID with the new ID
      currentDocXml = currentDocXml.replace(new RegExp(`r:id="${oldId}"`, 'g'), `r:id="${newId}"`);
    }
    zip.file('word/document.xml', currentDocXml);
  }

  // Fix duplicate bookmark IDs (docx library bug generates all with id="1")
  // OOXML requires unique IDs to properly pair bookmarkStart with bookmarkEnd
  fixBookmarkIds(zip);

  // Change content type from template to document
  // .dotx has contentType application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml
  // .docx needs application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml
  const contentTypesXml = zip.file('[Content_Types].xml')?.asText();
  if (contentTypesXml) {
    const updatedContentTypes = contentTypesXml.replace(
      /\.template\.main\+xml/g,
      '.document.main+xml'
    );
    zip.file('[Content_Types].xml', updatedContentTypes);
  }

  // Generate the final document
  return Buffer.from(zip.generate({ type: 'nodebuffer' }));
}

/**
 * Merge numbering.xml from two documents
 * @internal Reserved for future complex numbering merge scenarios
 */
function _mergeNumberingXml(templateXml: string, generatedXml: string): string {
  // Extract abstractNum and num elements from generated
  const abstractNumMatches =
    generatedXml.match(/<w:abstractNum[^>]*>[\s\S]*?<\/w:abstractNum>/g) || [];
  const numMatches = generatedXml.match(/<w:num[^>]*>[\s\S]*?<\/w:num>/g) || [];

  // Find the highest abstractNumId and numId in template
  let maxAbstractId = 0;
  let maxNumId = 0;

  const templateAbstractIds = templateXml.match(/w:abstractNumId="(\d+)"/g) || [];
  for (const match of templateAbstractIds) {
    const id = Number.parseInt(match.match(/\d+/)?.[0] || '0');
    if (id > maxAbstractId) maxAbstractId = id;
  }

  const templateNumIds = templateXml.match(/w:numId="(\d+)"/g) || [];
  for (const match of templateNumIds) {
    const id = Number.parseInt(match.match(/\d+/)?.[0] || '0');
    if (id > maxNumId) maxNumId = id;
  }

  // Renumber and insert generated numbering
  let insertAbstractNums = '';
  let insertNums = '';

  for (let i = 0; i < abstractNumMatches.length; i++) {
    const abstractNum = abstractNumMatches[i];
    if (abstractNum) {
      const newId = maxAbstractId + i + 1;
      insertAbstractNums += abstractNum.replace(
        /w:abstractNumId="(\d+)"/,
        `w:abstractNumId="${newId}"`
      );
    }
  }

  for (let i = 0; i < numMatches.length; i++) {
    const num = numMatches[i];
    if (num) {
      const newNumId = maxNumId + i + 1;
      const newAbstractId = maxAbstractId + i + 1;
      let updated = num.replace(/w:numId="(\d+)"/, `w:numId="${newNumId}"`);
      updated = updated.replace(/w:val="(\d+)"/, `w:val="${newAbstractId}"`);
      insertNums += updated;
    }
  }

  // Insert before closing </w:numbering>
  return templateXml.replace(/<\/w:numbering>/, `${insertAbstractNums}${insertNums}</w:numbering>`);
}

/**
 * Add numbering.xml to content types if missing
 * @internal Reserved for future complex numbering scenarios
 */
function _addNumberingToContentTypes(zip: PizZip): void {
  const contentTypesXml = zip.file('[Content_Types].xml')?.asText();
  if (contentTypesXml && !contentTypesXml.includes('numbering.xml')) {
    const updated = contentTypesXml.replace(
      /<\/Types>/,
      `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`
    );
    zip.file('[Content_Types].xml', updated);
  }
}

/**
 * Merge relationships from generated document into template
 * Also updates document.xml to use the new relationship IDs
 */
function mergeRelationships(templateZip: PizZip, contentZip: PizZip): Map<string, string> {
  const idMapping = new Map<string, string>();

  const templateRels = templateZip.file('word/_rels/document.xml.rels')?.asText();
  const generatedRels = contentZip.file('word/_rels/document.xml.rels')?.asText();

  if (!templateRels || !generatedRels) return idMapping;

  // Find max rId in template
  let maxRId = 0;
  const rIdMatches = templateRels.match(/Id="rId(\d+)"/g) || [];
  for (const match of rIdMatches) {
    const id = Number.parseInt(match.match(/\d+/)?.[0] || '0');
    if (id > maxRId) maxRId = id;
  }

  // Extract hyperlink relationships from generated document
  // The docx library generates random IDs like "rId-abc123xyz"
  const hyperlinkRels =
    generatedRels.match(/<Relationship[^>]*Type="[^"]*hyperlink"[^>]*\/>/g) || [];

  if (hyperlinkRels.length > 0) {
    let insertRels = '';
    for (let i = 0; i < hyperlinkRels.length; i++) {
      const rel = hyperlinkRels[i];
      if (rel) {
        // Extract the old ID (could be any format like rId-abc123 or rId5)
        const oldIdMatch = rel.match(/Id="([^"]+)"/);
        const oldId = oldIdMatch?.[1] || '';

        const newId = `rId${maxRId + i + 1}`;

        // Store mapping for updating document.xml references
        if (oldId) {
          idMapping.set(oldId, newId);
        }

        // Replace ID with numeric format
        insertRels += rel.replace(/Id="[^"]+"/, `Id="${newId}"`);
      }
    }

    // Insert before closing </Relationships>
    const updatedRels = templateRels.replace(/<\/Relationships>/, `${insertRels}</Relationships>`);
    templateZip.file('word/_rels/document.xml.rels', updatedRels);
  }

  return idMapping;
}

/**
 * Fix duplicate bookmark IDs in document.xml
 * The docx library generates all bookmarks with id="1", which breaks internal hyperlinks
 * OOXML requires unique IDs to pair bookmarkStart with bookmarkEnd
 */
function fixBookmarkIds(zip: PizZip): void {
  let docXml = zip.file('word/document.xml')?.asText();
  if (!docXml) return;

  // Find all bookmark names and assign unique IDs
  const bookmarkNames = new Map<string, number>();
  let nextId = 100; // Start at 100 to avoid conflicts with template bookmarks

  // First pass: find all bookmarkStart elements and assign unique IDs by name
  const startMatches = docXml.matchAll(/<w:bookmarkStart\s+w:name="([^"]+)"\s+w:id="(\d+)"\/>/g);
  for (const match of startMatches) {
    const name = match[1];
    if (name && !bookmarkNames.has(name)) {
      bookmarkNames.set(name, nextId++);
    }
  }

  // Also check for the alternate attribute order
  const startMatchesAlt = docXml.matchAll(/<w:bookmarkStart\s+w:id="(\d+)"\s+w:name="([^"]+)"\/>/g);
  for (const match of startMatchesAlt) {
    const name = match[2];
    if (name && !bookmarkNames.has(name)) {
      bookmarkNames.set(name, nextId++);
    }
  }

  // Replace each bookmarkStart with its unique ID
  for (const [name, id] of bookmarkNames) {
    // Handle both attribute orders
    docXml = docXml.replace(
      new RegExp(`<w:bookmarkStart\\s+w:name="${name}"\\s+w:id="\\d+"/>`, 'g'),
      `<w:bookmarkStart w:name="${name}" w:id="${id}"/>`
    );
    docXml = docXml.replace(
      new RegExp(`<w:bookmarkStart\\s+w:id="\\d+"\\s+w:name="${name}"/>`, 'g'),
      `<w:bookmarkStart w:id="${id}" w:name="${name}"/>`
    );
  }

  // Now fix bookmarkEnd elements - they appear immediately after their bookmarkStart
  // We need to match each bookmarkEnd to the preceding bookmarkStart
  // Strategy: Process document sequentially, tracking the last seen bookmark name

  // Split by bookmarkStart to process each section
  const parts = docXml.split(/(<w:bookmarkStart[^>]+\/>)/);
  let result = '';
  let lastBookmarkId = 1;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    // Check if this part is a bookmarkStart
    const startMatch = part.match(/<w:bookmarkStart[^>]+w:name="([^"]+)"[^>]+w:id="(\d+)"[^>]*\/>/);
    const startMatchAlt = part.match(
      /<w:bookmarkStart[^>]+w:id="(\d+)"[^>]+w:name="([^"]+)"[^>]*\/>/
    );

    if (startMatch) {
      lastBookmarkId = Number.parseInt(startMatch[2] || '1');
      result += part;
    } else if (startMatchAlt) {
      lastBookmarkId = Number.parseInt(startMatchAlt[1] || '1');
      result += part;
    } else {
      // Replace bookmarkEnd with the correct ID from the preceding bookmarkStart
      // Only replace the FIRST bookmarkEnd in this section (the one paired with our start)
      let replaced = false;
      result += part.replace(/<w:bookmarkEnd\s+w:id="\d+"\/>/g, (match: string) => {
        if (!replaced) {
          replaced = true;
          return `<w:bookmarkEnd w:id="${lastBookmarkId}"/>`;
        }
        return match;
      });
    }
  }

  zip.file('word/document.xml', result);
}

/**
 * Build cover page paragraphs from metadata
 * Professional layout: Title near top, formal metadata structure
 */
function buildCoverPage(metadata: DocumentMetadata): Paragraph[] {
  const elements: Paragraph[] = [];

  // Minimal top spacing - title starts closer to header
  elements.push(
    new Paragraph({
      spacing: { before: 400 }, // Minimal spacing below header
      children: [],
    })
  );

  // Title
  if (metadata.title) {
    elements.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        keepNext: true,
        children: [
          new TextRun({
            text: metadata.title,
            bold: true,
            size: 56, // 28pt
            color: 'FF6600', // Orbit orange
          }),
        ],
      })
    );
  }

  // Subtitle
  if (metadata.subtitle) {
    elements.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        keepNext: true,
        children: [
          new TextRun({
            text: metadata.subtitle,
            size: 36, // 18pt
            color: '444444',
          }),
        ],
      })
    );
  }

  // Formal metadata block - each field on separate line
  if (metadata.author) {
    elements.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 60 },
        children: [
          new TextRun({ text: 'Author: ', size: 24 }),
          new TextRun({ text: metadata.author, size: 24 }),
        ],
      })
    );
  }

  if (metadata.date) {
    elements.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [
          new TextRun({ text: 'Date: ', size: 24 }),
          new TextRun({ text: metadata.date, size: 24 }),
        ],
      })
    );
  }

  if (metadata.version) {
    elements.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [
          new TextRun({ text: 'Version: ', size: 24 }),
          new TextRun({ text: metadata.version, size: 24 }),
        ],
      })
    );
  }

  // Confidentiality
  if (metadata.confidentiality) {
    elements.push(
      new Paragraph({
        spacing: { before: 200 },
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: metadata.confidentiality.toUpperCase(),
            bold: true,
            size: 24,
            color: 'CC0000',
          }),
        ],
      })
    );
  }

  return elements;
}

/**
 * Build Table of Contents
 */
function buildTableOfContents(): TableOfContents {
  return new TableOfContents('Table of Contents', {
    hyperlink: true,
    headingStyleRange: '1-3',
    stylesWithLevels: [
      new StyleLevel('Heading1', 1),
      new StyleLevel('Heading2', 2),
      new StyleLevel('Heading3', 3),
    ],
  });
}

/**
 * Build numbering configuration for lists
 */
function buildNumberingConfig(): INumberingOptions {
  return {
    config: [
      {
        reference: 'default-numbering',
        levels: [
          {
            level: 0,
            format: 'decimal',
            text: '%1.',
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 360 },
              },
            },
          },
          {
            level: 1,
            format: 'lowerLetter',
            text: '%2.',
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: 1440, hanging: 360 },
              },
            },
          },
          {
            level: 2,
            format: 'lowerRoman',
            text: '%3.',
            alignment: AlignmentType.START,
            style: {
              paragraph: {
                indent: { left: 2160, hanging: 360 },
              },
            },
          },
        ],
      },
    ],
  };
}

/**
 * Save document to file
 */
export async function saveDocument(buffer: Buffer, outputPath: string): Promise<void> {
  const resolvedPath = outputPath.replace(/^~/, process.env.HOME || '');
  fs.writeFileSync(resolvedPath, buffer);
}

/**
 * Simple document creation without template (fallback)
 */
export async function createSimpleDocument(
  markdown: string,
  metadata?: DocumentMetadata
): Promise<Buffer> {
  const contentElements = await markdownToDocx(markdown, {});
  const coverPage = metadata ? buildCoverPage(metadata) : [];
  const toc = buildTableOfContents();

  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: 'Quote',
          name: 'Quote',
          basedOn: 'Normal',
          next: 'Normal',
          run: {
            italics: true,
            color: '666666',
          },
          paragraph: {
            indent: { left: 720 },
          },
        },
        {
          id: 'Code',
          name: 'Code',
          basedOn: 'Normal',
          run: {
            font: 'Consolas',
            size: 20,
          },
          paragraph: {
            shading: { fill: 'F5F5F5' },
          },
        },
      ],
    },
    sections: [
      {
        children: [
          ...coverPage,
          new Paragraph({ children: [new PageBreak()] }),
          toc,
          new Paragraph({ children: [new PageBreak()] }),
          ...contentElements,
        ],
      },
    ],
    numbering: buildNumberingConfig(),
  });

  // Get buffer and fix bookmark IDs
  const buffer = await Packer.toBuffer(doc);

  // Fix duplicate bookmark IDs in the generated document
  const zip = new PizZip(buffer);
  fixBookmarkIds(zip);

  return Buffer.from(zip.generate({ type: 'nodebuffer' }));
}
