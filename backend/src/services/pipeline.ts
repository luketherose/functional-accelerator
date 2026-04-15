/**
 * Multi-step functional analysis pipeline — RAG edition.
 *
 *   Step 1 — Extract AS-IS functional catalog  (RAG retrieval → prompt)
 *   Step 2 — Extract TO-BE functional catalog  (RAG retrieval → prompt)
 *   Step 3 — Evidence-based comparison + delta detection
 *   Step 3b— Verification pass (string match, no Claude call)
 *   Step 4 — Synthesise final AnalysisResult
 *
 * Context strategy:
 *   • If the project has indexed chunks (file_chunks table), we use semantic
 *     search (Voyage AI embeddings + cosine similarity) to select the most
 *     relevant passages for each step.
 *   • If no chunks are indexed yet (files uploaded before RAG was introduced),
 *     we fall back to the original full-text extraction path so nothing breaks.
 */

import type { ProjectFile, AnalysisResult } from '../types';
import type { ImpactFeedback } from './promptBuilder';
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  buildComparisonSystemPrompt,
  buildComparisonUserPrompt,
  buildSynthesisSystemPrompt,
  buildSynthesisUserPrompt,
  type FunctionalCatalog,
  type ComparisonResult,
  type Delta,
} from './promptBuilder';
import { callClaudeStep } from './claude';
import { chunkDocument, formatAllChunks, formatChunksAsContext } from './chunking';
import { retrieveTopChunks, mergeChunkLists, verifyQuoteInChunks, retrieveBySection } from './retrieval';
import { hasIndexedChunks, formatRetrievedChunks } from './vectorStore';
import { orchestrateRetrieval, classifyIntent } from './queryOrchestrator';
import type { FileBucket } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OQAnswer {
  question_text: string;
  sentiment: 'positive' | 'negative' | null;
  answer: string | null;
}

export interface PipelineOptions {
  /** Called at each step transition so the route can persist progress to DB. */
  onProgress?: (step: string) => void;
  prevFeedback?: ImpactFeedback[];
  prevOQAnswers?: OQAnswer[];
  /** Project ID — needed for RAG vector store lookup. */
  projectId?: string;
}

// ─── Mock fixture ────────────────────────────────────────────────────────────

function mockResult(): AnalysisResult {
  return {
    executiveSummary:
      '[MOCK] This is a placeholder analysis. Set CLAUDE_MOCK=false and provide an ANTHROPIC_API_KEY for real results.',
    functionalImpacts: [
      { id: 'FI-01', area: 'Mock Area', description: 'Mock functional impact.', severity: 'low' },
    ],
    uiUxImpacts: [],
    affectedScreens: [],
    businessRulesExtracted: [],
    proposedChanges: [],
    prototypeInstructions: '',
    prototypeHtml: '',
    assumptions: ['Running in mock mode — no real analysis was performed.'],
    openQuestions: [],
  };
}

// ─── Context helpers ─────────────────────────────────────────────────────────

const EXTRACTION_CHAR_BUDGET = 130_000; // fallback: full-text budget
const COMPARISON_CHUNKS_PER_SIDE = 20;
const RAG_TOP_K_EXTRACTION = 40;   // chunks per query for extraction steps
const RAG_TOP_K_COMPARISON = 25;   // chunks per query for comparison evidence

/**
 * Hybrid extraction context using the query orchestrator.
 * Uses BM25 + semantic retrieval + reranking for higher recall and precision.
 */
async function buildExtractionContextRAG(
  projectId: string,
  bucket: FileBucket,
  charBudget = EXTRACTION_CHAR_BUDGET
): Promise<string> {
  const queries = [
    `functional requirements ${bucket}`,
    'business rules and processes',
    'user roles and permissions',
    'data fields and validation',
    'system integrations and APIs',
    'workflow and approval processes',
    'notifications and communications',
  ];

  const result = await orchestrateRetrieval({
    projectId,
    bucket,
    queries,
    topK: RAG_TOP_K_EXTRACTION,
    charBudget,
    label: `${bucket.toUpperCase()} Documents`,
    intent: 'general',
  });

  console.log(
    `[pipeline] Extraction context for ${bucket}: ` +
    `${result.chunkCount} chunks (${result.strategy}), ` +
    `${result.graphEntityCount} graph entities`
  );

  // Append graph context if available (provides structured dependency hints)
  if (result.graphContext) {
    return result.formattedContext + '\n\n' + result.graphContext;
  }
  return result.formattedContext;
}

/**
 * Fallback: full-text extraction context (no vector store).
 */
function buildExtractionContextFallback(files: ProjectFile[], charBudget: number): string {
  if (files.length === 0) return '_No documents uploaded._';
  const allChunks = files.flatMap(f =>
    f.extracted_text ? chunkDocument(f.extracted_text, f.original_name, f.bucket) : []
  );
  return formatAllChunks(allChunks, 'Documents', charBudget);
}

/**
 * Hybrid comparison context using the query orchestrator.
 * Uses the extracted catalog areas as targeted queries.
 */
async function buildComparisonContextRAG(
  projectId: string,
  catalog: FunctionalCatalog,
  bucket: FileBucket,
  charBudget = EXTRACTION_CHAR_BUDGET
): Promise<string> {
  const queries = catalog.areas.flatMap(a => [
    a.name,
    ...a.keyFields.slice(0, 2),
    ...a.businessRules.slice(0, 1),
  ]).filter(Boolean).slice(0, 20);

  const result = await orchestrateRetrieval({
    projectId,
    bucket,
    queries,
    topK: RAG_TOP_K_COMPARISON,
    charBudget,
    label: `${bucket.toUpperCase()} Source Passages`,
    intent: 'gap_analysis',
  });

  console.log(
    `[pipeline] Comparison context for ${bucket}: ` +
    `${result.chunkCount} chunks (${result.strategy})`
  );

  return result.formattedContext;
}

/**
 * Fallback: BM25 keyword comparison context (no vector store).
 */
function buildComparisonContextFallback(
  catalog: FunctionalCatalog,
  files: ProjectFile[],
  bucket: 'as-is' | 'to-be'
): string {
  const bucketFiles = files.filter(f => f.bucket === bucket);
  if (bucketFiles.length === 0) return '_No documents._';

  const allChunks = bucketFiles.flatMap(f =>
    f.extracted_text ? chunkDocument(f.extracted_text, f.original_name, f.bucket) : []
  );

  const query = catalog.areas
    .flatMap(a => [a.name, ...a.keyFields, ...a.businessRules.slice(0, 2)])
    .join(' ');

  const byKeyword = retrieveTopChunks(allChunks, query, COMPARISON_CHUNKS_PER_SIDE);
  const bySection = retrieveBySection(allChunks, catalog.areas.map(a => a.name));
  const merged = mergeChunkLists(byKeyword, bySection).slice(0, COMPARISON_CHUNKS_PER_SIDE + 10);

  return formatChunksAsContext(merged, `${bucket.toUpperCase()} Source Passages`);
}

// ─── Verification pass ───────────────────────────────────────────────────────

/**
 * Verifies each delta's evidence quotes against the actual source chunks.
 * Marks evidence as verified=false (and downgrades confidence) when a quote
 * cannot be found in any source chunk.
 *
 * Deltas where NEITHER side's evidence is verifiable are downgraded to UNCERTAIN.
 */
function verifyDeltas(deltas: Delta[], files: ProjectFile[]): Delta[] {
  const asisChunks = files
    .filter(f => f.bucket === 'as-is' && f.extracted_text)
    .flatMap(f => chunkDocument(f.extracted_text!, f.original_name, f.bucket));

  const tobeChunks = files
    .filter(f => f.bucket === 'to-be' && f.extracted_text)
    .flatMap(f => chunkDocument(f.extracted_text!, f.original_name, f.bucket));

  return deltas.map(delta => {
    let asIsEvidence = delta.asIsEvidence;
    let toBeEvidence = delta.toBeEvidence;
    let confidence = delta.confidence;
    let changeType = delta.changeType;

    if (asIsEvidence?.quote) {
      const found = verifyQuoteInChunks(asIsEvidence.quote, asisChunks);
      asIsEvidence = { ...asIsEvidence, verified: found };
      if (!found) confidence = Math.max(0, confidence - 0.25);
    }

    if (toBeEvidence?.quote) {
      const found = verifyQuoteInChunks(toBeEvidence.quote, tobeChunks);
      toBeEvidence = { ...toBeEvidence, verified: found };
      if (!found) confidence = Math.max(0, confidence - 0.25);
    }

    // If neither side can be verified and the delta claims a change, downgrade
    const asIsVerified = asIsEvidence?.verified ?? true;
    const toBeVerified = toBeEvidence?.verified ?? true;
    if (!asIsVerified && !toBeVerified && changeType !== 'UNCHANGED') {
      changeType = 'UNCERTAIN';
      confidence = Math.min(confidence, 0.3);
    }

    return {
      ...delta,
      asIsEvidence,
      toBeEvidence,
      changeType,
      confidence,
      needsHumanReview: delta.needsHumanReview || confidence < 0.7,
    };
  });
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export async function runAnalysisPipeline(
  project: { name: string; description: string },
  files: ProjectFile[],
  options: PipelineOptions = {}
): Promise<AnalysisResult> {
  const { onProgress, prevFeedback = [], prevOQAnswers = [], projectId } = options;

  // ── Mock mode ──────────────────────────────────────────────────────────────
  if (process.env.CLAUDE_MOCK === 'true') {
    onProgress?.('Mock mode — returning fixture data');
    return mockResult();
  }

  const asisFiles = files.filter(f => f.bucket === 'as-is');
  const tobeFiles = files.filter(f => f.bucket === 'to-be');
  const brFiles = files.filter(f => f.bucket === 'business-rules');

  // ── Decide retrieval strategy ──────────────────────────────────────────────
  const useRAG = projectId ? hasIndexedChunks(projectId) : false;
  console.log(`[pipeline] Retrieval strategy: ${useRAG ? 'RAG (vector store)' : 'fallback (full-text)'}`);

  // ── Step 1: Extract AS-IS catalog ─────────────────────────────────────────
  onProgress?.('Step 1/4 — Extracting AS-IS functional catalog…');
  console.log('[pipeline] Step 1: AS-IS extraction');

  const asisContext = useRAG && projectId
    ? await buildExtractionContextRAG(projectId, 'as-is')
    : buildExtractionContextFallback(asisFiles, EXTRACTION_CHAR_BUDGET);

  const asisCatalog = await callClaudeStep<FunctionalCatalog>(
    buildExtractionSystemPrompt(),
    buildExtractionUserPrompt('AS-IS', asisContext),
    0.1,
    32000
  );
  console.log(`[pipeline] AS-IS catalog: ${asisCatalog.areas?.length ?? 0} areas`);

  // ── Step 2: Extract TO-BE catalog ─────────────────────────────────────────
  onProgress?.('Step 2/4 — Extracting TO-BE functional catalog…');
  console.log('[pipeline] Step 2: TO-BE extraction');

  let tobeContext: string;
  if (useRAG && projectId) {
    // Use multi-bucket orchestration to combine to-be + business-rules
    const result = await orchestrateRetrieval({
      projectId,
      bucket: ['to-be', 'business-rules'],
      queries: [
        'functional requirements to-be', 'business rules', 'new processes',
        'user roles permissions', 'data fields validation', 'system integrations',
        'business rules', 'constraints', 'eligibility', 'validation rules',
      ],
      topK: RAG_TOP_K_EXTRACTION,
      charBudget: EXTRACTION_CHAR_BUDGET,
      label: 'TO-BE + Business Rules Documents',
      intent: 'general',
    });
    tobeContext = result.graphContext
      ? result.formattedContext + '\n\n' + result.graphContext
      : result.formattedContext;
  } else {
    tobeContext = buildExtractionContextFallback([...tobeFiles, ...brFiles], EXTRACTION_CHAR_BUDGET);
  }

  const tobeCatalog = await callClaudeStep<FunctionalCatalog>(
    buildExtractionSystemPrompt(),
    buildExtractionUserPrompt('TO-BE', tobeContext),
    0.1,
    32000
  );
  console.log(`[pipeline] TO-BE catalog: ${tobeCatalog.areas?.length ?? 0} areas`);

  // ── Step 3: Evidence-based comparison ─────────────────────────────────────
  onProgress?.('Step 3/4 — Comparing functional areas and detecting deltas…');
  console.log('[pipeline] Step 3: Comparison');

  // Retrieve the most relevant source passages for each side
  const [asisEvidenceContext, tobeEvidenceContext] = useRAG && projectId
    ? await Promise.all([
        buildComparisonContextRAG(projectId, tobeCatalog, 'as-is'),
        buildComparisonContextRAG(projectId, asisCatalog, 'to-be'),
      ])
    : [
        buildComparisonContextFallback(tobeCatalog, files, 'as-is'),
        buildComparisonContextFallback(asisCatalog, files, 'to-be'),
      ];

  const comparison = await callClaudeStep<ComparisonResult>(
    buildComparisonSystemPrompt(),
    buildComparisonUserPrompt(asisCatalog, tobeCatalog, asisEvidenceContext, tobeEvidenceContext),
    0.1,
    32000
  );
  const rawDeltas: Delta[] = comparison.deltas ?? [];
  console.log(`[pipeline] Raw deltas: ${rawDeltas.length}`);

  // ── Verification pass (no Claude call — string matching) ──────────────────
  onProgress?.('Step 3/4 — Verifying evidence…');
  const verifiedDeltas = verifyDeltas(rawDeltas, files);
  const unverified = verifiedDeltas.filter(d => d.needsHumanReview).length;
  console.log(`[pipeline] Verified deltas: ${verifiedDeltas.length} (${unverified} need human review)`);

  // Propagate any coverage warning from comparison step
  const coverageWarning = comparison.coverageMetrics?.coverageWarning ?? null;

  // ── Step 4: Synthesise final report ───────────────────────────────────────
  onProgress?.('Step 4/4 — Synthesising final report…');
  console.log('[pipeline] Step 4: Synthesis');

  // Only send actionable deltas to synthesis (skip UNCHANGED to save tokens)
  const actionableDeltas = verifiedDeltas.filter(d => d.changeType !== 'UNCHANGED');

  const result = await callClaudeStep<AnalysisResult>(
    buildSynthesisSystemPrompt(),
    buildSynthesisUserPrompt(project, actionableDeltas, coverageWarning, prevFeedback, prevOQAnswers),
    0.2,
    32000
  );

  // Normalise to ensure all arrays are present
  return {
    executiveSummary: result.executiveSummary || 'No summary produced.',
    functionalImpacts: Array.isArray(result.functionalImpacts) ? result.functionalImpacts : [],
    uiUxImpacts: Array.isArray(result.uiUxImpacts) ? result.uiUxImpacts : [],
    affectedScreens: Array.isArray(result.affectedScreens) ? result.affectedScreens : [],
    businessRulesExtracted: Array.isArray(result.businessRulesExtracted) ? result.businessRulesExtracted : [],
    proposedChanges: Array.isArray(result.proposedChanges) ? result.proposedChanges : [],
    prototypeInstructions: result.prototypeInstructions || '',
    prototypeHtml: result.prototypeHtml || '',
    assumptions: Array.isArray(result.assumptions) ? result.assumptions : [],
    openQuestions: Array.isArray(result.openQuestions) ? result.openQuestions : [],
  };
}
