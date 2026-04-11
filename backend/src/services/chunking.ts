import { v4 as uuidv4 } from 'uuid';
import type { FileBucket } from '../types';

export interface Chunk {
  id: string;
  docName: string;
  docType: FileBucket;
  sectionPath: string;
  content: string;
  wordCount: number;
}

const MAX_CHUNK_CHARS = 3_000;
const MIN_CHUNK_CHARS = 80;

/**
 * Splits a document into semantic chunks based on heading structure.
 * Preserves section hierarchy in chunk metadata so evidence can be cited by section name.
 *
 * Heading patterns detected:
 *  - Markdown headings: # Heading, ## Heading, ### Heading
 *  - Numbered sections: 1. Title, 1.1 Title, 2.3.4 Title
 *  - ALL-CAPS lines (common in Word-extracted docs): CUSTOMER RISK ASSESSMENT
 */
export function chunkDocument(text: string, docName: string, docType: FileBucket): Chunk[] {
  const lines = text.split('\n');
  const chunks: Chunk[] = [];

  let currentSection = 'Introduction';
  let currentLines: string[] = [];

  const flush = () => {
    const content = currentLines.join('\n').trim();
    if (content.length < MIN_CHUNK_CHARS) return;

    if (content.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        id: uuidv4(),
        docName,
        docType,
        sectionPath: currentSection,
        content,
        wordCount: content.split(/\s+/).length,
      });
    } else {
      // Split oversized chunk by paragraphs
      for (const sub of splitByParagraphs(content, MAX_CHUNK_CHARS)) {
        if (sub.trim().length >= MIN_CHUNK_CHARS) {
          chunks.push({
            id: uuidv4(),
            docName,
            docType,
            sectionPath: currentSection,
            content: sub.trim(),
            wordCount: sub.trim().split(/\s+/).length,
          });
        }
      }
    }
    currentLines = [];
  };

  for (const line of lines) {
    const heading = detectHeading(line);
    if (heading !== null) {
      flush();
      currentSection = heading;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return chunks;
}

/**
 * Returns the heading text if the line is a heading, otherwise null.
 */
function detectHeading(line: string): string | null {
  const trimmed = line.trim();

  // Markdown heading
  const mdMatch = trimmed.match(/^#{1,4}\s+(.+)/);
  if (mdMatch) return mdMatch[1].trim();

  // Numbered section: 1. / 1.1 / 1.1.1 etc. (require at least 5 chars of title)
  const numMatch = trimmed.match(/^(\d+(?:\.\d+)*\.?)\s+([A-Z].{4,})/);
  if (numMatch) return `${numMatch[1]} ${numMatch[2].trim()}`;

  // ALL-CAPS line (Word-style heading), at least 6 chars, no punctuation at start
  if (
    trimmed.length >= 6 &&
    trimmed.length <= 80 &&
    trimmed === trimmed.toUpperCase() &&
    /^[A-Z]/.test(trimmed) &&
    !/[.!?]$/.test(trimmed)
  ) {
    return trimmed;
  }

  return null;
}

function splitByParagraphs(text: string, maxChars: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const result: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length > 0 && current.length + para.length + 2 > maxChars) {
      result.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) result.push(current);
  return result;
}

/**
 * Formats an array of chunks as a labelled context block for use in Claude prompts.
 * Groups chunks by document, showing section path before each chunk.
 */
export function formatChunksAsContext(chunks: Chunk[], label: string): string {
  if (chunks.length === 0) return `### ${label}\n_No content available._\n`;

  return `### ${label}\n\n` + chunks.map(c =>
    `**[${c.docName} — ${c.sectionPath}]**\n${c.content}`
  ).join('\n\n---\n\n');
}

/**
 * Formats all chunks from a set of files as one combined context string.
 * Respects a character budget — stops adding chunks once the budget is exceeded.
 */
export function formatAllChunks(chunks: Chunk[], label: string, charBudget = 120_000): string {
  if (chunks.length === 0) return `### ${label}\n_No content available._\n`;

  let total = 0;
  const included: Chunk[] = [];
  for (const c of chunks) {
    if (total + c.content.length > charBudget) break;
    included.push(c);
    total += c.content.length;
  }

  const truncated = included.length < chunks.length;
  const header = `### ${label}${truncated ? ` _(first ${included.length} of ${chunks.length} sections, budget limit reached)_` : ''}\n\n`;
  return header + included.map(c =>
    `**[${c.docName} — ${c.sectionPath}]**\n${c.content}`
  ).join('\n\n---\n\n');
}

/**
 * Entry point for semantic chunking used by the functional extraction pipeline.
 * Delegates to chunkDocument(); exists as a named seam so future iterations can
 * swap in larger chunk sizes or different boundary detection without touching callers.
 */
export function semanticChunk(text: string, docName: string, docType: import('../types').FileBucket): Chunk[] {
  return chunkDocument(text, docName, docType);
}
