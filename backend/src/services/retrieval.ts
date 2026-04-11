import type { Chunk } from './chunking';

// Common English + domain stopwords (do not score on these)
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had',
  'do', 'does', 'did', 'not', 'this', 'that', 'these', 'those', 'it', 'its',
  'by', 'from', 'as', 'if', 'into', 'than', 'then', 'so', 'no', 'all',
  'customer', 'system', 'process', 'data', 'information', 'value', 'field',
  'shall', 'should', 'must', 'will', 'may', 'can', 'via', 'per', 'each',
]);

/**
 * Splits a string into meaningful search terms, removing stopwords and short tokens.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Scores a chunk's relevance to a set of query terms.
 * Uses a simple TF-style count with a bonus for section-path matches.
 */
function scoreChunk(chunk: Chunk, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 1;

  const body = chunk.content.toLowerCase();
  const section = chunk.sectionPath.toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'g');

    // Term frequency in content (capped to avoid single-keyword dominance)
    const bodyMatches = (body.match(re) || []).length;
    score += Math.min(bodyMatches, 5);

    // Bonus if term appears in the section heading
    if (section.includes(term)) score += 4;
  }

  return score;
}

/**
 * Retrieves the top-N chunks most relevant to the given query.
 * Uses keyword/TF scoring (structural + content).
 *
 * If no chunks score > 0, returns the first topN chunks (fallback).
 */
export function retrieveTopChunks(chunks: Chunk[], query: string, topN = 15): Chunk[] {
  const terms = tokenize(query);
  const scored = chunks.map(c => ({ chunk: c, score: scoreChunk(c, terms) }));
  scored.sort((a, b) => b.score - a.score);

  const positive = scored.filter(s => s.score > 0);
  if (positive.length > 0) return positive.slice(0, topN).map(s => s.chunk);

  // Fallback: return first topN in document order
  return chunks.slice(0, topN);
}

/**
 * Retrieves chunks whose section path contains any of the given keywords.
 * Useful for structural retrieval when you know the section name.
 */
export function retrieveBySection(chunks: Chunk[], sectionKeywords: string[]): Chunk[] {
  const kws = sectionKeywords.map(k => k.toLowerCase());
  return chunks.filter(c =>
    kws.some(kw => c.sectionPath.toLowerCase().includes(kw))
  );
}

/**
 * Merges two chunk lists (deduplicating by id), preserving order of first list,
 * then appending unique items from second list.
 * Useful to combine semantic and structural retrieval results.
 */
export function mergeChunkLists(primary: Chunk[], secondary: Chunk[]): Chunk[] {
  const seen = new Set(primary.map(c => c.id));
  const result = [...primary];
  for (const c of secondary) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      result.push(c);
    }
  }
  return result;
}

/**
 * Verifies whether a short quote string actually appears in any chunk's content.
 * Used during the verification pass to check if evidence quotes are real.
 *
 * Performs a lenient match: normalises whitespace and is case-insensitive.
 */
export function verifyQuoteInChunks(quote: string, chunks: Chunk[]): boolean {
  if (!quote || quote.length < 10) return false;

  // Normalise: collapse whitespace, lowercase
  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const normQuote = normalise(quote);

  // Use a 30-char sliding window from the quote to allow partial matches
  // (Claude may paraphrase slightly; we check if a key 30-char phrase is present)
  const windows: string[] = [];
  const step = 20;
  for (let i = 0; i + 30 <= normQuote.length; i += step) {
    windows.push(normQuote.slice(i, i + 30));
  }
  // Also check the full normalised quote for short quotes
  if (normQuote.length <= 80) windows.push(normQuote);

  for (const chunk of chunks) {
    const normContent = normalise(chunk.content);
    for (const window of windows) {
      if (normContent.includes(window)) return true;
    }
  }
  return false;
}
