/**
 * Query Orchestrator — unified retrieval pipeline for analysis queries.
 *
 * This is the main entry point for any "retrieve context for a query" call.
 * It replaces the ad-hoc multiQuerySearch / semanticSearch calls scattered
 * across pipeline.ts with a single, consistent, progressively enhanced path.
 *
 * Pipeline (per query):
 *   1. Intent classification (local, no LLM)
 *   2. Hybrid retrieval (vector + BM25 + RRF) — or semantic-only fallback
 *   3. Reranking (Voyage rerank-2 or score-fusion fallback)
 *   4. Optional knowledge graph expansion (if graph has data)
 *   5. Context assembly with char budget
 *
 * The orchestrator gracefully degrades:
 *   - No FTS5 data → semantic-only retrieval
 *   - No Voyage key → mock embeddings + BM25 (still returns results)
 *   - No KG data → skip graph expansion
 *   - Reranker unavailable → score-fusion fallback
 *
 * Export surface:
 *   orchestrateRetrieval()     — full pipeline, returns formatted context string
 *   orchestrateMultiRetrieval()— multi-query version, returns formatted context
 */

import { hybridMultiSearch, hybridSearch, type HybridChunk } from './hybridRetrieval';
import { multiQuerySearch, formatRetrievedChunks, hasIndexedChunks, type RetrievedChunk } from './vectorStore';
import { rerank, asHybridChunks, type RankedChunk } from './reranker';
import {
  getEntitiesForChunks,
  graphNeighbours,
  getEntityCount,
  formatGraphContext,
  buildEntityIndex,
  type KGEntity,
} from './knowledgeGraph';
import { hasFTSIndex } from './bm25Store';
import type { FileBucket } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueryIntent =
  | 'summary'
  | 'gap_analysis'
  | 'impact_analysis'
  | 'dependency_trace'
  | 'ui_proposal'
  | 'general';

export interface OrchestratorOptions {
  projectId: string;
  bucket: FileBucket | FileBucket[];
  queries: string[];
  topK?: number;
  charBudget?: number;
  label?: string;
  useGraph?: boolean;        // default: true if graph has data
  useReranker?: boolean;     // default: true
  intent?: QueryIntent;
}

export interface OrchestratorResult {
  formattedContext: string;
  chunks: RankedChunk[];
  graphContext: string;
  strategy: 'hybrid' | 'semantic-only';
  chunkCount: number;
  graphEntityCount: number;
}

// ─── Main entry points ────────────────────────────────────────────────────────

/**
 * Retrieve context for a set of queries over one or more buckets.
 * This is the primary function to use in pipeline.ts and other callers.
 */
export async function orchestrateRetrieval(opts: OrchestratorOptions): Promise<OrchestratorResult> {
  const {
    projectId,
    bucket,
    queries,
    topK = 25,
    charBudget = 100_000,
    label = 'Documents',
    useReranker = true,
    intent = 'general',
  } = opts;

  // Decide whether to include graph expansion
  const hasGraph = getEntityCount(projectId) > 0;
  const useGraph = opts.useGraph !== undefined ? opts.useGraph : hasGraph;

  // Handle multi-bucket queries by running per-bucket and merging
  if (Array.isArray(bucket)) {
    return orchestrateMultiBucket(opts, hasGraph, useGraph);
  }

  // ── Step 1: Hybrid retrieval ──────────────────────────────────────────────
  const hasIndex = hasIndexedChunks(projectId);
  if (!hasIndex) {
    return {
      formattedContext: '_No indexed content found. Please wait for indexing to complete._',
      chunks: [],
      graphContext: '',
      strategy: 'semantic-only',
      chunkCount: 0,
      graphEntityCount: 0,
    };
  }

  const useFTS = hasFTSIndex(projectId, bucket);
  const strategy: 'hybrid' | 'semantic-only' = useFTS ? 'hybrid' : 'semantic-only';

  // Retrieve broader candidate set for reranking
  const candidateK = useReranker ? Math.min(topK * 3, 80) : topK;

  let rawChunks: HybridChunk[];
  if (useFTS) {
    rawChunks = await hybridMultiSearch(projectId, bucket, queries, candidateK);
  } else {
    const semResults = await multiQuerySearch(projectId, bucket, queries, candidateK);
    rawChunks = asHybridChunks(semResults) as HybridChunk[];
  }

  // ── Step 2: Reranking ─────────────────────────────────────────────────────
  const primaryQuery = queries[0] ?? intent;
  let ranked: RankedChunk[];
  if (useReranker && rawChunks.length > topK) {
    ranked = await rerank(primaryQuery, rawChunks, topK);
  } else {
    ranked = rawChunks.slice(0, topK).map(c => ({ ...c, rerankScore: c.rrfScore }));
  }

  // ── Step 3: Knowledge graph expansion ────────────────────────────────────
  let graphContext = '';
  let graphEntityCount = 0;

  if (useGraph && ranked.length > 0) {
    const chunkIds = ranked.map(c => c.id);
    const seedEntities = getEntitiesForChunks(chunkIds);

    if (seedEntities.length > 0) {
      const hops = intent === 'dependency_trace' || intent === 'impact_analysis' ? 2 : 1;
      const { entities, relations } = graphNeighbours(seedEntities.map(e => e.id), hops);
      const allEntities = [...seedEntities, ...entities];
      graphEntityCount = allEntities.length;

      const entityIndex = buildEntityIndex(allEntities);
      graphContext = formatGraphContext(allEntities, relations, entityIndex);
    }
  }

  // ── Step 4: Format context ────────────────────────────────────────────────
  const formattedContext = formatRetrievedChunks(ranked, label, charBudget);

  return {
    formattedContext,
    chunks: ranked,
    graphContext,
    strategy,
    chunkCount: ranked.length,
    graphEntityCount,
  };
}

// ─── Multi-bucket orchestration ───────────────────────────────────────────────

async function orchestrateMultiBucket(
  opts: OrchestratorOptions,
  hasGraph: boolean,
  useGraph: boolean
): Promise<OrchestratorResult> {
  const buckets = opts.bucket as FileBucket[];
  const perBucketK = Math.ceil((opts.topK ?? 25) / buckets.length) * 2;

  const bucketResults = await Promise.all(
    buckets.map(b => orchestrateRetrieval({ ...opts, bucket: b, topK: perBucketK, useGraph: false }))
  );

  // Merge all chunks, deduplicate by id, re-sort by rerankScore
  const best = new Map<string, RankedChunk>();
  for (const r of bucketResults) {
    for (const c of r.chunks) {
      const prev = best.get(c.id);
      if (!prev || c.rerankScore > prev.rerankScore) best.set(c.id, c);
    }
  }

  const merged = [...best.values()]
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, opts.topK ?? 25);

  // Graph expansion over merged set
  let graphContext = '';
  let graphEntityCount = 0;
  if (useGraph && merged.length > 0) {
    const chunkIds = merged.map(c => c.id);
    const seedEntities = getEntitiesForChunks(chunkIds);
    if (seedEntities.length > 0) {
      const { entities, relations } = graphNeighbours(seedEntities.map(e => e.id), 1);
      const allEntities = [...seedEntities, ...entities];
      graphEntityCount = allEntities.length;
      const entityIndex = buildEntityIndex(allEntities);
      graphContext = formatGraphContext(allEntities, relations, entityIndex);
    }
  }

  const formattedContext = formatRetrievedChunks(merged, opts.label ?? 'Documents', opts.charBudget ?? 100_000);

  const strategy = bucketResults.some(r => r.strategy === 'hybrid') ? 'hybrid' : 'semantic-only';

  return {
    formattedContext,
    chunks: merged,
    graphContext,
    strategy,
    chunkCount: merged.length,
    graphEntityCount,
  };
}

// ─── Intent classification ────────────────────────────────────────────────────

/**
 * Classify query intent from keywords — purely local, no LLM call.
 * Used to tune retrieval parameters (hop depth, rerank, etc.).
 */
export function classifyIntent(query: string): QueryIntent {
  const q = query.toLowerCase();

  if (/\bgap\b|\bmissing\b|\bnot.*covered\b|\bwhat.*changed\b/.test(q))
    return 'gap_analysis';

  if (/\bimpact\b|\baffect\b|\bdownstream\b|\bbreak\b/.test(q))
    return 'impact_analysis';

  if (/\bdepend\b|\brelat\b|\blink\b|\btrace\b|\bpath\b/.test(q))
    return 'dependency_trace';

  if (/\bscreen\b|\bui\b|\bux\b|\bprototype\b|\bmockup\b|\blayout\b/.test(q))
    return 'ui_proposal';

  if (/\bsummar\b|\boverview\b|\bexecutive\b|\bbriefing\b/.test(q))
    return 'summary';

  return 'general';
}
