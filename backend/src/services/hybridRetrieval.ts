/**
 * Hybrid retrieval: fuses vector (semantic) search with BM25 (lexical) search
 * using Reciprocal Rank Fusion (RRF).
 *
 * RRF formula:
 *   score(doc) = Σ  1 / (k + rank_i(doc))
 *   for each retrieval list i, where k=60 (standard constant)
 *
 * This approach is model-free and consistently outperforms either signal alone,
 * especially on enterprise documents with exact identifiers, field names, and
 * acronyms that semantic search may miss.
 *
 * Export surface:
 *   hybridSearch()       — single-query hybrid search
 *   hybridMultiSearch()  — multi-query hybrid search (dedup by best RRF score)
 */

import {
  semanticSearch,
  type RetrievedChunk,
} from './vectorStore';
import { bm25MultiSearch, bm25Search } from './bm25Store';
import db from '../db';
import type { FileBucket } from '../types';

// RRF constant — 60 is the standard value from the original RRF paper
const RRF_K = 60;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HybridChunk extends RetrievedChunk {
  rrfScore: number;    // final RRF score (higher = more relevant)
  semanticScore: number;
  bm25Score: number;
}

// ─── Core RRF Fusion ─────────────────────────────────────────────────────────

/**
 * Single-query hybrid search.
 *
 * 1. Run semantic search (vector cosine similarity)
 * 2. Run BM25 search (FTS5)
 * 3. Fuse results via RRF
 * 4. Hydrate chunk content from DB for any BM25-only results
 */
export async function hybridSearch(
  projectId: string,
  bucket: FileBucket,
  query: string,
  topK = 25
): Promise<HybridChunk[]> {
  // Run both searches in parallel
  const [semanticResults, bm25Results] = await Promise.all([
    semanticSearch(projectId, bucket, query, topK * 2), // broader candidate set
    Promise.resolve(bm25Search(projectId, bucket, query, topK * 2)),
  ]);

  return fuseResults(semanticResults, bm25Results, topK, projectId, bucket);
}

/**
 * Multi-query hybrid search.
 * Runs all queries through both retrievers, deduplicates by chunk keeping best RRF score.
 */
export async function hybridMultiSearch(
  projectId: string,
  bucket: FileBucket,
  queries: string[],
  topK = 30
): Promise<HybridChunk[]> {
  if (queries.length === 0) return [];

  const [semanticResults, bm25Results] = await Promise.all([
    // Run all semantic queries in parallel
    Promise.all(queries.map(q => semanticSearch(projectId, bucket, q, topK * 2)))
      .then(results => deduplicateSemantic(results)),
    Promise.resolve(bm25MultiSearch(projectId, bucket, queries, topK * 2)),
  ]);

  return fuseResults(semanticResults, bm25Results, topK, projectId, bucket);
}

// ─── RRF Implementation ───────────────────────────────────────────────────────

function fuseResults(
  semanticResults: RetrievedChunk[],
  bm25Results: { chunkId: string; score: number }[],
  topK: number,
  projectId: string,
  bucket: FileBucket
): HybridChunk[] {
  // Build score maps
  const semanticRank = new Map<string, { rank: number; chunk: RetrievedChunk }>();
  semanticResults.forEach((chunk, i) => {
    semanticRank.set(chunk.id, { rank: i + 1, chunk });
  });

  const bm25Rank = new Map<string, { rank: number; score: number }>();
  bm25Results.forEach((r, i) => {
    bm25Rank.set(r.chunkId, { rank: i + 1, score: r.score });
  });

  // Collect all unique chunk IDs from both lists
  const allIds = new Set<string>([
    ...semanticRank.keys(),
    ...bm25Rank.keys(),
  ]);

  const fused: Array<{
    id: string;
    rrfScore: number;
    semScore: number;
    bm25Score: number;
    semRank: number;
    bm25Rank: number;
  }> = [];

  for (const id of allIds) {
    const sem = semanticRank.get(id);
    const bm = bm25Rank.get(id);

    const semContrib = sem ? 1 / (RRF_K + sem.rank) : 0;
    const bm25Contrib = bm ? 1 / (RRF_K + bm.rank) : 0;

    fused.push({
      id,
      rrfScore: semContrib + bm25Contrib,
      semScore: sem?.chunk.score ?? 0,
      bm25Score: bm?.score ?? 0,
      semRank: sem?.rank ?? 9999,
      bm25Rank: bm?.rank ?? 9999,
    });
  }

  fused.sort((a, b) => b.rrfScore - a.rrfScore);
  const top = fused.slice(0, topK);

  // Hydrate: for chunks only in BM25 results (not in semantic), fetch from DB
  const needsHydration = top.filter(r => !semanticRank.has(r.id));
  const hydrated = hydrateChunks(needsHydration.map(r => r.id));

  return top.map(r => {
    const semChunk = semanticRank.get(r.id)?.chunk;
    const dbChunk = hydrated.get(r.id);
    const source = semChunk ?? dbChunk;

    if (!source) return null; // chunk was deleted between search and hydration

    return {
      id: source.id,
      fileId: source.fileId,
      bucket: source.bucket ?? bucket,
      sectionPath: source.sectionPath,
      content: source.content,
      score: r.semScore,        // keep semantic score for compatibility
      rrfScore: r.rrfScore,
      semanticScore: r.semScore,
      bm25Score: r.bm25Score,
    } as HybridChunk;
  }).filter((c): c is HybridChunk => c !== null);
}

/** Deduplicate multiple semantic result lists — keep highest score per chunk. */
function deduplicateSemantic(lists: RetrievedChunk[][]): RetrievedChunk[] {
  const best = new Map<string, RetrievedChunk>();
  for (const list of lists) {
    for (const chunk of list) {
      const prev = best.get(chunk.id);
      if (!prev || chunk.score > prev.score) best.set(chunk.id, chunk);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/** Fetch chunk rows from DB for IDs that weren't in the semantic results. */
function hydrateChunks(ids: string[]): Map<string, RetrievedChunk> {
  if (ids.length === 0) return new Map();

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, file_id, bucket, section_path, content FROM file_chunks WHERE id IN (${placeholders})`
  ).all(...ids) as { id: string; file_id: string; bucket: string; section_path: string; content: string }[];

  return new Map(rows.map(r => [r.id, {
    id: r.id,
    fileId: r.file_id,
    bucket: r.bucket as FileBucket,
    sectionPath: r.section_path,
    content: r.content,
    score: 0,
  }]));
}
