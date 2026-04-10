/**
 * Vector store backed by SQLite (file_chunks table).
 *
 * Responsibilities:
 *   1. indexFile()   — chunk a file, embed all chunks, persist to DB
 *   2. semanticSearch() — embed a query and return top-K chunks by cosine similarity
 *   3. deleteFileChunks() — remove all chunks for a file (called on file delete)
 *   4. formatChunksForPrompt() — render retrieved chunks as a prompt context block
 *
 * When VOYAGE_MOCK=true (or no VOYAGE_API_KEY), embeddings are mock vectors
 * so the full pipeline still works in dev without a real Voyage key.
 */

import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { chunkDocument } from './chunking';
import {
  embedBatch,
  embedQuery,
  serializeEmbedding,
  deserializeEmbedding,
  cosineSimilarity,
} from './embeddings';
import type { FileBucket } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChunkRow {
  id: string;
  file_id: string;
  project_id: string;
  bucket: string;
  section_path: string;
  content: string;
  word_count: number;
  embedding: Buffer | null;
}

export interface RetrievedChunk {
  id: string;
  fileId: string;
  bucket: FileBucket;
  sectionPath: string;
  content: string;
  score: number; // cosine similarity
}

// ─── Indexing ─────────────────────────────────────────────────────────────────

/**
 * Index a single file:
 *  1. Chunk the extracted text using the existing chunkDocument()
 *  2. Batch-embed all chunks via Voyage AI
 *  3. Upsert rows into file_chunks (delete old chunks first for idempotency)
 */
export async function indexFile(
  fileId: string,
  projectId: string,
  bucket: FileBucket,
  originalName: string,
  extractedText: string
): Promise<{ chunksIndexed: number }> {
  // Remove any existing chunks for this file (re-index on re-upload)
  db.prepare('DELETE FROM file_chunks WHERE file_id = ?').run(fileId);

  const chunks = chunkDocument(extractedText, originalName, bucket);
  if (chunks.length === 0) return { chunksIndexed: 0 };

  const texts = chunks.map(c => c.content);
  console.log(`[vectorStore] Embedding ${chunks.length} chunks for file ${originalName}…`);
  const embeddings = await embedBatch(texts);

  const insert = db.prepare(`
    INSERT INTO file_chunks (id, file_id, project_id, bucket, section_path, content, word_count, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction(() => {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embeddingBlob = serializeEmbedding(embeddings[i].embedding);
      insert.run(
        uuidv4(),
        fileId,
        projectId,
        bucket,
        chunk.sectionPath,
        chunk.content,
        chunk.wordCount,
        embeddingBlob
      );
    }
  });

  insertMany();
  console.log(`[vectorStore] Indexed ${chunks.length} chunks for ${originalName}`);
  return { chunksIndexed: chunks.length };
}

/**
 * Remove all chunks for a file (call when a file is deleted).
 */
export function deleteFileChunks(fileId: string): void {
  db.prepare('DELETE FROM file_chunks WHERE file_id = ?').run(fileId);
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

/**
 * Semantic search: embed the query and rank all chunks in the given bucket
 * by cosine similarity. Returns topK results sorted by score desc.
 *
 * Falls back gracefully to keyword-scored ranking if embeddings are null
 * (e.g. file was uploaded before indexing was introduced).
 */
export async function semanticSearch(
  projectId: string,
  bucket: FileBucket,
  query: string,
  topK = 25
): Promise<RetrievedChunk[]> {
  const rows = db.prepare(
    'SELECT * FROM file_chunks WHERE project_id = ? AND bucket = ?'
  ).all(projectId, bucket) as ChunkRow[];

  if (rows.length === 0) return [];

  const queryVec = await embedQuery(query);

  const scored = rows.map(row => {
    let score = 0;
    if (row.embedding) {
      const vec = deserializeEmbedding(row.embedding);
      score = cosineSimilarity(queryVec, vec);
    } else {
      // Fallback: simple keyword overlap score
      score = keywordScore(query, row.content);
    }
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map(({ row, score }) => ({
    id: row.id,
    fileId: row.file_id,
    bucket: row.bucket as FileBucket,
    sectionPath: row.section_path,
    content: row.content,
    score,
  }));
}

/**
 * Multi-query search: run multiple queries and merge results (dedup by chunk id,
 * keeping the highest score). Useful for searching with multiple topic strings.
 */
export async function multiQuerySearch(
  projectId: string,
  bucket: FileBucket,
  queries: string[],
  topK = 30
): Promise<RetrievedChunk[]> {
  if (queries.length === 0) return [];

  const allResults = await Promise.all(
    queries.map(q => semanticSearch(projectId, bucket, q, topK))
  );

  // Merge and deduplicate — keep highest score per chunk
  const best = new Map<string, RetrievedChunk>();
  for (const results of allResults) {
    for (const chunk of results) {
      const existing = best.get(chunk.id);
      if (!existing || chunk.score > existing.score) {
        best.set(chunk.id, chunk);
      }
    }
  }

  const merged = [...best.values()];
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, topK);
}

/**
 * Returns true if the project has indexed chunks (i.e. at least one file
 * was indexed after RAG was introduced). Used to decide whether to use
 * vector retrieval or fall back to full-text extraction.
 */
export function hasIndexedChunks(projectId: string): boolean {
  const row = db.prepare(
    'SELECT COUNT(*) as c FROM file_chunks WHERE project_id = ?'
  ).get(projectId) as { c: number };
  return row.c > 0;
}

// ─── Prompt formatting ────────────────────────────────────────────────────────

/**
 * Format retrieved chunks as a context block for inclusion in a prompt.
 * Each chunk is prefixed with its section path for traceability.
 */
export function formatRetrievedChunks(
  chunks: RetrievedChunk[],
  label: string,
  charBudget = 80_000
): string {
  if (chunks.length === 0) return `_No ${label} content retrieved._`;

  const lines: string[] = [`## ${label}\n`];
  let used = 0;

  for (const chunk of chunks) {
    const header = `### ${chunk.sectionPath || 'Section'}\n`;
    const body = chunk.content + '\n\n';
    const block = header + body;

    if (used + block.length > charBudget) break;
    lines.push(block);
    used += block.length;
  }

  return lines.join('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'that', 'this',
  'it', 'its', 'not', 'no', 'if', 'then', 'than', 'so', 'when', 'which',
]);

function keywordScore(query: string, text: string): number {
  const terms = query.toLowerCase().split(/\W+/).filter(t => t.length > 2 && !STOPWORDS.has(t));
  if (terms.length === 0) return 0;
  const lower = text.toLowerCase();
  const matches = terms.filter(t => lower.includes(t)).length;
  return matches / terms.length;
}
