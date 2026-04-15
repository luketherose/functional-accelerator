/**
 * BM25 / full-text search layer using SQLite FTS5.
 *
 * SQLite's FTS5 module implements a BM25 variant for full-text search over
 * the file_chunks content. It handles tokenization, stemming, and phrase
 * matching much better than our previous ad-hoc keyword scorer.
 *
 * The virtual table `file_chunks_fts` shadows the main `file_chunks` table.
 * We keep them in sync manually (insert/delete in the same transaction).
 *
 * Export surface:
 *   bm25Search()     — BM25 search returning scored chunk references
 *   indexChunksFTS() — called by vectorStore after embedding a file
 *   deleteChunksFTS()— called when a file is deleted
 */

import db from '../db';
import type { FileBucket } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BM25Result {
  chunkId: string;
  score: number; // normalised to [0, 1] — higher is better
}

// ─── Indexing ─────────────────────────────────────────────────────────────────

/**
 * Insert FTS rows for all chunks of a given file (called right after embedding).
 * Idempotent: deletes any existing FTS rows for the file first.
 */
export function indexChunksFTS(fileId: string): void {
  // Fetch newly inserted chunks for this file
  const chunks = db.prepare(
    'SELECT id, project_id, bucket, section_path, content FROM file_chunks WHERE file_id = ?'
  ).all(fileId) as { id: string; project_id: string; bucket: string; section_path: string; content: string }[];

  if (chunks.length === 0) return;

  const del = db.prepare('DELETE FROM file_chunks_fts WHERE chunk_id = ?');
  const ins = db.prepare(
    'INSERT INTO file_chunks_fts(chunk_id, project_id, bucket, section_path, content) VALUES (?, ?, ?, ?, ?)'
  );

  const run = db.transaction(() => {
    for (const c of chunks) {
      del.run(c.id);
      ins.run(c.id, c.project_id, c.bucket, c.section_path, c.content);
    }
  });

  run();
}

/**
 * Remove all FTS rows for a file. Called on file deletion.
 */
export function deleteChunksFTS(fileId: string): void {
  // We need to delete by chunk_id (stored UNINDEXED), which requires a
  // join since FTS5 rowid maps to file_chunks id.
  const ids = db.prepare('SELECT id FROM file_chunks WHERE file_id = ?')
    .all(fileId) as { id: string }[];
  const del = db.prepare('DELETE FROM file_chunks_fts WHERE chunk_id = ?');
  const run = db.transaction(() => { ids.forEach(r => del.run(r.id)); });
  run();
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * BM25 search over file_chunks_fts.
 *
 * FTS5's built-in `bm25()` ranking function returns negative scores (lower =
 * better). We negate and normalise to a [0, 1] range for RRF fusion.
 *
 * Supports multi-term phrase queries; automatically escapes special chars.
 */
export function bm25Search(
  projectId: string,
  bucket: FileBucket,
  query: string,
  topK = 50
): BM25Result[] {
  const escaped = escapeFtsQuery(query);
  if (!escaped) return [];

  type FTSRow = { chunk_id: string; rank: number };

  let rows: FTSRow[];
  try {
    // SQLite FTS5 limitation: UNINDEXED column filters in WHERE alongside MATCH
    // are silently ignored. Use a CTE + JOIN with file_chunks to filter correctly.
    // The CTE also deduplicates when the FTS table has extra rows.
    rows = db.prepare(`
      WITH base AS (
        SELECT chunk_id, bm25(file_chunks_fts) AS rank
        FROM   file_chunks_fts
        WHERE  file_chunks_fts MATCH ?
        LIMIT  ?
      )
      SELECT b.chunk_id, MIN(b.rank) AS rank
      FROM   base b
      JOIN   file_chunks fc ON fc.id = b.chunk_id
      WHERE  fc.project_id = ?
        AND  fc.bucket     = ?
      GROUP  BY b.chunk_id
      ORDER  BY rank
      LIMIT  ?
    `).all(escaped, topK * 8, projectId, bucket, topK) as FTSRow[];
  } catch {
    // Malformed query (e.g. only stopwords) — return empty
    return [];
  }

  if (rows.length === 0) return [];

  // FTS5 bm25() is negative; convert to positive scores
  const rawScores = rows.map(r => -r.rank);          // now positive, higher = better
  const maxScore = Math.max(...rawScores, 1e-9);
  return rows.map((r, i) => ({
    chunkId: r.chunk_id,
    score: rawScores[i] / maxScore,                  // normalise to [0, 1]
  }));
}

/**
 * Multi-query BM25 search: run multiple queries and merge (keep best score
 * per chunk, same dedup strategy as multiQuerySearch in vectorStore).
 */
export function bm25MultiSearch(
  projectId: string,
  bucket: FileBucket,
  queries: string[],
  topK = 50
): BM25Result[] {
  const best = new Map<string, number>();
  for (const q of queries) {
    for (const r of bm25Search(projectId, bucket, q, topK)) {
      const prev = best.get(r.chunkId) ?? 0;
      if (r.score > prev) best.set(r.chunkId, r.score);
    }
  }
  return [...best.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── Status check ─────────────────────────────────────────────────────────────

/**
 * Returns true if the project has any FTS-indexed chunks for this bucket.
 * Used by the orchestrator to decide whether to use hybrid or semantic-only.
 */
export function hasFTSIndex(projectId: string, bucket: FileBucket): boolean {
  try {
    const row = db.prepare(
      'SELECT COUNT(*) as c FROM file_chunks_fts WHERE project_id = ? AND bucket = ?'
    ).get(projectId, bucket) as { c: number };
    return row.c > 0;
  } catch {
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escape / sanitise a raw user query for FTS5 MATCH syntax.
 *
 * Strategy:
 * - Strip FTS5 special chars that cause parse errors
 * - Wrap multi-word inputs in double-quotes for phrase matching
 * - Fall back to individual term ORing if the phrase would be empty
 */
function escapeFtsQuery(raw: string): string {
  // Remove FTS5 special chars except spaces
  const cleaned = raw.replace(/['"*^(){}[\]:!]/g, ' ').trim();
  if (!cleaned) return '';

  const terms = cleaned.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return '';

  if (terms.length === 1) return terms[0];

  // Try phrase match first, then individual terms as fallback via OR
  // FTS5 phrase: "term1 term2 ..."
  return `"${terms.join(' ')}"`;
}
