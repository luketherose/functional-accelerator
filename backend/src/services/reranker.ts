/**
 * Reranking layer — improves precision by re-scoring a broad candidate set
 * against the original query using a cross-encoder model.
 *
 * Primary: Voyage AI rerank API (`rerank-2` model).
 * Fallback: Score-fusion reranking using the hybrid RRF score directly
 *           (used when VOYAGE_API_KEY is absent or VOYAGE_MOCK=true).
 *
 * Usage:
 *   const reranked = await rerank(query, chunks, topK);
 *
 * The reranker should be applied AFTER hybrid retrieval, on a broader
 * candidate set (e.g., top 50–80 from hybrid), then sliced to the final topK.
 */

import type { HybridChunk } from './hybridRetrieval';
import type { RetrievedChunk } from './vectorStore';

const VOYAGE_RERANK_URL = 'https://api.voyageai.com/v1/rerank';
const RERANK_MODEL = 'rerank-2';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RankedChunk extends HybridChunk {
  rerankScore: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Rerank a list of hybrid chunks against a query.
 *
 * - If Voyage API key is available: uses Voyage rerank-2 model
 * - Otherwise: falls back to RRF score passthrough (no extra API call)
 *
 * Always returns at most `topK` results, sorted by relevance.
 */
export async function rerank(
  query: string,
  chunks: HybridChunk[],
  topK = 20
): Promise<RankedChunk[]> {
  if (chunks.length === 0) return [];
  if (chunks.length <= topK) {
    // No point reranking fewer candidates than we need — just annotate with RRF score
    return chunks.map(c => ({ ...c, rerankScore: c.rrfScore }));
  }

  const apiKey = process.env.VOYAGE_API_KEY;
  const mockMode = process.env.VOYAGE_MOCK === 'true' || !apiKey;

  if (mockMode) {
    return scoreFusionFallback(chunks, topK);
  }

  try {
    return await voyageRerank(query, chunks, topK, apiKey!);
  } catch (err) {
    console.warn('[reranker] Voyage rerank failed, falling back to score fusion:', err);
    return scoreFusionFallback(chunks, topK);
  }
}

/**
 * Convenience wrapper: takes any RetrievedChunk[] (from vectorStore) and
 * wraps them as HybridChunk so they can go through the reranker.
 */
export function asHybridChunks(chunks: RetrievedChunk[]): HybridChunk[] {
  return chunks.map((c, i) => ({
    ...c,
    rrfScore: 1 / (60 + i + 1), // synthetic RRF score based on position
    semanticScore: c.score,
    bm25Score: 0,
  }));
}

// ─── Voyage AI Rerank ─────────────────────────────────────────────────────────

async function voyageRerank(
  query: string,
  chunks: HybridChunk[],
  topK: number,
  apiKey: string
): Promise<RankedChunk[]> {
  const documents = chunks.map(c => c.content);

  const response = await fetch(VOYAGE_RERANK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      documents,
      model: RERANK_MODEL,
      top_k: topK,
      return_documents: false,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Voyage rerank error ${response.status}: ${err}`);
  }

  const json = await response.json() as {
    data: { index: number; relevance_score: number }[];
  };

  return json.data.map(item => ({
    ...chunks[item.index],
    rerankScore: item.relevance_score,
  })).sort((a, b) => b.rerankScore - a.rerankScore);
}

// ─── Fallback: Score-Fusion Reranking ────────────────────────────────────────

/**
 * When no reranker API is available, combine RRF score, semantic score, and
 * BM25 score with fixed weights and return the top K.
 *
 * Weights:
 *   RRF score:      50% — already a good fusion of both signals
 *   Semantic score: 30% — quality of embedding match
 *   BM25 score:     20% — exact keyword / phrase match bonus
 */
function scoreFusionFallback(chunks: HybridChunk[], topK: number): RankedChunk[] {
  // Normalise each score array to [0,1]
  const maxRRF = Math.max(...chunks.map(c => c.rrfScore), 1e-9);
  const maxSem = Math.max(...chunks.map(c => c.semanticScore), 1e-9);
  const maxBM25 = Math.max(...chunks.map(c => c.bm25Score), 1e-9);

  return chunks
    .map(c => {
      const combined =
        0.5 * (c.rrfScore / maxRRF) +
        0.3 * (c.semanticScore / maxSem) +
        0.2 * (c.bm25Score / maxBM25);
      return { ...c, rerankScore: combined };
    })
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topK);
}
