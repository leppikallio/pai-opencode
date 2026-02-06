/**
 * Document editing module
 * Append/modify existing Word documents
 */

import * as fs from 'node:fs';
import { Document, Packer, PageBreak, Paragraph, Table, TableOfContents } from 'docx';
import PizZip from 'pizzip';
import { markdownToDocx } from './DocxCliMarkdown.ts';

export interface EditOptions {
  /** Base path for resolving relative image paths */
  basePath?: string;
}

/**
 * Append markdown content to an existing document
 *
 * Strategy: Extract document.xml, parse structure, append new content,
 * then repack the docx.
 */
export async function appendToDocument(
  documentPath: string,
  markdown: string,
  options: EditOptions = {}
): Promise<Buffer> {
  const resolvedPath = documentPath.replace(/^~/, process.env.HOME || '');

  // Read existing document
  const content = fs.readFileSync(resolvedPath);
  const zip = new PizZip(content);

  // Get the document.xml
  const documentXml = zip.file('word/document.xml')?.asText();
  if (!documentXml) {
    throw new Error('Invalid docx: missing word/document.xml');
  }

  // Convert markdown to docx elements
  const newElements = await markdownToDocx(markdown, {
    basePath: options.basePath,
  });

  // Get existing styles.xml for the new document
  const stylesXml = zip.file('word/styles.xml')?.asText() || '';

  // Create a new document with existing styles + new content
  // This is a simplified approach - full editing would require
  // parsing and modifying the XML directly

  // For now, we create a merged document
  const _doc = new Document({
    externalStyles: stylesXml,
    sections: [
      {
        children: [
          // Add a page break before new content
          new Paragraph({
            children: [new PageBreak()],
          }),
          // Add new content
          ...newElements,
        ],
      },
    ],
  });

  // This approach creates a NEW document with the appended content
  // For true editing, we'd need to modify the XML directly
  // Let's implement a more sophisticated approach

  return await appendContentToDocx(zip, newElements);
}

/**
 * Append docx elements to an existing zip archive
 */
async function appendContentToDocx(
  zip: PizZip,
  elements: (Paragraph | Table | TableOfContents)[]
): Promise<Buffer> {
  // Get the document.xml content
  const documentXml = zip.file('word/document.xml')?.asText();
  if (!documentXml) {
    throw new Error('Invalid docx: missing word/document.xml');
  }

  // Find the closing </w:body> tag
  const bodyCloseIndex = documentXml.lastIndexOf('</w:body>');
  if (bodyCloseIndex === -1) {
    throw new Error('Invalid docx: cannot find </w:body> tag');
  }

  // Generate XML for new content
  // We'll create a temporary document and extract its body content
  const tempDoc = new Document({
    sections: [
      {
        children: [new Paragraph({ children: [new PageBreak()] }), ...elements],
      },
    ],
  });

  const tempBuffer = await Packer.toBuffer(tempDoc);
  const tempZip = new PizZip(tempBuffer);
  const tempDocXml = tempZip.file('word/document.xml')?.asText();

  if (!tempDocXml) {
    throw new Error('Failed to generate content XML');
  }

  // Extract body content from temp document
  const bodyStartMatch = tempDocXml.match(/<w:body[^>]*>/);
  const bodyEndMatch = tempDocXml.match(/<\/w:body>/);

  if (!bodyStartMatch || !bodyEndMatch) {
    throw new Error('Failed to parse temp document body');
  }

  const bodyStartIndex = tempDocXml.indexOf(bodyStartMatch[0]) + bodyStartMatch[0].length;
  const bodyEndIndex = tempDocXml.lastIndexOf('</w:body>');
  const newBodyContent = tempDocXml.slice(bodyStartIndex, bodyEndIndex);

  // Also need to remove the sectPr from the new content (we keep original doc's sectPr)
  const cleanedContent = newBodyContent.replace(/<w:sectPr[^>]*>[\s\S]*?<\/w:sectPr>/g, '');

  // Insert new content before </w:body>
  const newDocumentXml =
    documentXml.slice(0, bodyCloseIndex) + cleanedContent + documentXml.slice(bodyCloseIndex);

  // Update the document.xml in the zip
  zip.file('word/document.xml', newDocumentXml);

  // Merge any new media files
  const tempMediaFiles = Object.keys(tempZip.files).filter((f) => f.startsWith('word/media/'));
  for (const mediaPath of tempMediaFiles) {
    const mediaContent = tempZip.file(mediaPath)?.asNodeBuffer();
    if (mediaContent && !zip.file(mediaPath)) {
      zip.file(mediaPath, mediaContent);
    }
  }

  // Merge relationships if needed
  mergeRelationships(zip, tempZip);

  // Merge [Content_Types].xml if needed
  mergeContentTypes(zip, tempZip);

  // Generate the final buffer
  return zip.generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

/**
 * Merge relationships from temp document into original
 */
function mergeRelationships(originalZip: PizZip, tempZip: PizZip): void {
  const originalRels = originalZip.file('word/_rels/document.xml.rels')?.asText();
  const tempRels = tempZip.file('word/_rels/document.xml.rels')?.asText();

  if (!originalRels || !tempRels) return;

  // Extract relationships from temp that don't exist in original
  const existingIds = new Set<string>();
  const idRegex = /Id="([^"]*)"/g;
  let match: RegExpExecArray | null = idRegex.exec(originalRels);
  while (match !== null) {
    if (match[1]) existingIds.add(match[1]);
    match = idRegex.exec(originalRels);
  }

  // Find new relationships
  const relRegex = /<Relationship[^>]*\/>/g;
  const newRels: string[] = [];
  let relMatch: RegExpExecArray | null = relRegex.exec(tempRels);
  while (relMatch !== null) {
    const rel = relMatch[0];
    const idMatch = rel.match(/Id="([^"]*)"/);
    if (idMatch?.[1] && !existingIds.has(idMatch[1])) {
      // Renumber the ID to avoid conflicts
      const newId = `rId${existingIds.size + newRels.length + 100}`;
      const updatedRel = rel.replace(/Id="[^"]*"/, `Id="${newId}"`);
      newRels.push(updatedRel);
    }
    relMatch = relRegex.exec(tempRels);
  }

  if (newRels.length > 0) {
    // Insert new relationships before closing tag
    const closeIndex = originalRels.lastIndexOf('</Relationships>');
    const updatedRels =
      originalRels.slice(0, closeIndex) + newRels.join('\n') + originalRels.slice(closeIndex);
    originalZip.file('word/_rels/document.xml.rels', updatedRels);
  }
}

/**
 * Merge content types from temp document into original
 */
function mergeContentTypes(originalZip: PizZip, tempZip: PizZip): void {
  const originalCT = originalZip.file('[Content_Types].xml')?.asText();
  const tempCT = tempZip.file('[Content_Types].xml')?.asText();

  if (!originalCT || !tempCT) return;

  // Extract existing extensions and parts
  const existingExts = new Set<string>();
  const extRegex = /Extension="([^"]*)"/g;
  let extMatch: RegExpExecArray | null = extRegex.exec(originalCT);
  while (extMatch !== null) {
    if (extMatch[1]) existingExts.add(extMatch[1]);
    extMatch = extRegex.exec(originalCT);
  }

  // Find new extensions
  const defaultRegex = /<Default[^>]*\/>/g;
  const newDefaults: string[] = [];
  let defaultMatch: RegExpExecArray | null = defaultRegex.exec(tempCT);
  while (defaultMatch !== null) {
    const def = defaultMatch[0];
    const extMatchInner = def.match(/Extension="([^"]*)"/);
    if (extMatchInner?.[1] && !existingExts.has(extMatchInner[1])) {
      newDefaults.push(def);
      existingExts.add(extMatchInner[1]);
    }
    defaultMatch = defaultRegex.exec(tempCT);
  }

  if (newDefaults.length > 0) {
    // Insert new defaults after opening tag
    const openIndex = originalCT.indexOf('<Types');
    const closeTagIndex = originalCT.indexOf('>', openIndex);
    const updatedCT = `${originalCT.slice(0, closeTagIndex + 1)}\n${newDefaults.join('\n')}${originalCT.slice(closeTagIndex + 1)}`;
    originalZip.file('[Content_Types].xml', updatedCT);
  }
}

/**
 * Extract text content from a docx file (for preview/analysis)
 */
export function extractText(documentPath: string): string {
  const resolvedPath = documentPath.replace(/^~/, process.env.HOME || '');
  const content = fs.readFileSync(resolvedPath);
  const zip = new PizZip(content);

  const documentXml = zip.file('word/document.xml')?.asText();
  if (!documentXml) {
    throw new Error('Invalid docx: missing word/document.xml');
  }

  // Extract text from <w:t> tags
  const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  const texts: string[] = [];
  let textMatch: RegExpExecArray | null = textRegex.exec(documentXml);
  while (textMatch !== null) {
    if (textMatch[1]) texts.push(textMatch[1]);
    textMatch = textRegex.exec(documentXml);
  }

  return texts.join(' ');
}

/**
 * Extract markdown-like text content from a docx file
 */
export function extractMarkdown(documentPath: string): string {
  const resolvedPath = documentPath.replace(/^~/, process.env.HOME || '');
  const content = fs.readFileSync(resolvedPath);
  const zip = new PizZip(content);

  const documentXml = zip.file('word/document.xml')?.asText();
  if (!documentXml) {
    throw new Error('Invalid docx: missing word/document.xml');
  }

  const paragraphRegex = /<w:p[\s\S]*?<\/w:p>/g;
  const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  const paragraphs = documentXml.match(paragraphRegex) || [];
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const parts: string[] = [];
    let match: RegExpExecArray | null = textRegex.exec(paragraph);
    while (match !== null) {
      if (match[1]) parts.push(match[1]);
      match = textRegex.exec(paragraph);
    }
    const text = parts.join('');
    if (text.trim()) lines.push(text);
  }

  return lines.join('\n\n');
}
