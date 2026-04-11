import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { cosineSimilarity, deserializeEmbedding } from './embeddings';
import { callClaudeStep } from './claude';
import { buildAlignmentConfirmationPrompt } from './promptBuilder';
import type { FunctionalComponent, AlignmentPair, MatchType } from '../types';

const MOCK = process.env.CLAUDE_MOCK === 'true';
const SIMILARITY_THRESHOLD = 0.75;

interface AlignmentConfirmation {
  match: boolean;
  confidence: number;
  reason: string;
}

const insertPairStmt = db.prepare(
  `INSERT INTO alignment_pairs (id, run_id, as_is_component_id, to_be_component_id, match_type, confidence, match_reason)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

function loadComponentsForVersions(
  versionIds: string[]
): Array<FunctionalComponent & { embedding_blob: Buffer | null }> {
  if (versionIds.length === 0) return [];
  const placeholders = versionIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT id, document_version_id, type, title, description, condition_text, action_text,
              source_section, source_quote, confidence, embedding as embedding_blob, created_at
       FROM functional_components
       WHERE document_version_id IN (${placeholders})`
    )
    .all(...versionIds) as Array<FunctionalComponent & { embedding_blob: Buffer | null }>;
}

function insertAlignmentPair(pair: AlignmentPair): void {
  insertPairStmt.run(
    pair.id,
    pair.run_id,
    pair.as_is_component_id,
    pair.to_be_component_id,
    pair.match_type,
    pair.confidence,
    pair.match_reason
  );
}

export async function alignComponents(
  runId: string,
  asIsVersionIds: string[],
  toBeVersionIds: string[],
  threshold: number = SIMILARITY_THRESHOLD
): Promise<AlignmentPair[]> {
  const asIsRaw = loadComponentsForVersions(asIsVersionIds);
  const toBeRaw = loadComponentsForVersions(toBeVersionIds);

  if (asIsRaw.length === 0 && toBeRaw.length === 0) return [];

  const pairs: AlignmentPair[] = [];
  const matchedToBeIds = new Set<string>();

  if (MOCK) {
    const minLen = Math.min(asIsRaw.length, toBeRaw.length);
    for (let i = 0; i < asIsRaw.length; i++) {
      const asIs = asIsRaw[i];
      if (i < minLen) {
        const toBe = toBeRaw[i];
        matchedToBeIds.add(toBe.id);
        const pair: AlignmentPair = {
          id: uuidv4(),
          run_id: runId,
          as_is_component_id: asIs.id,
          to_be_component_id: toBe.id,
          match_type: 'confirmed',
          confidence: 0.85,
          match_reason: 'Mock alignment',
        };
        insertAlignmentPair(pair);
        pairs.push(pair);
      } else {
        const pair: AlignmentPair = {
          id: uuidv4(),
          run_id: runId,
          as_is_component_id: asIs.id,
          to_be_component_id: null,
          match_type: 'unmatched_asis',
          confidence: null,
          match_reason: null,
        };
        insertAlignmentPair(pair);
        pairs.push(pair);
      }
    }
    for (const toBe of toBeRaw) {
      if (!matchedToBeIds.has(toBe.id)) {
        const pair: AlignmentPair = {
          id: uuidv4(),
          run_id: runId,
          as_is_component_id: null,
          to_be_component_id: toBe.id,
          match_type: 'unmatched_tobe',
          confidence: null,
          match_reason: null,
        };
        insertAlignmentPair(pair);
        pairs.push(pair);
      }
    }
    return pairs;
  }

  const asIsComponents = asIsRaw.map(r => ({
    ...r,
    vec: r.embedding_blob ? deserializeEmbedding(r.embedding_blob) : null,
  }));
  const toBeComponents = toBeRaw.map(r => ({
    ...r,
    vec: r.embedding_blob ? deserializeEmbedding(r.embedding_blob) : null,
  }));

  for (const asIs of asIsComponents) {
    const candidates: Array<{ component: (typeof toBeComponents)[0]; similarity: number }> = [];

    for (const toBe of toBeComponents) {
      if (matchedToBeIds.has(toBe.id)) continue;

      let similarity = 0;
      if (asIs.vec && toBe.vec) {
        similarity = cosineSimilarity(asIs.vec, toBe.vec);
      } else {
        // Fallback: simple title word-overlap score
        const asIsWords = new Set(asIs.title.toLowerCase().split(/\s+/));
        const toBeWords = toBe.title.toLowerCase().split(/\s+/);
        const overlap = toBeWords.filter(w => asIsWords.has(w)).length;
        similarity =
          overlap > 0 ? overlap / Math.max(asIsWords.size, toBeWords.length) : 0;
      }

      if (similarity >= threshold) {
        candidates.push({ component: toBe, similarity });
      }
    }

    if (candidates.length === 0) {
      const pair: AlignmentPair = {
        id: uuidv4(),
        run_id: runId,
        as_is_component_id: asIs.id,
        to_be_component_id: null,
        match_type: 'unmatched_asis',
        confidence: null,
        match_reason: null,
      };
      insertAlignmentPair(pair);
      pairs.push(pair);
      continue;
    }

    candidates.sort((a, b) => b.similarity - a.similarity);
    const best = candidates[0];

    let matchType: MatchType = 'rejected';
    let confidence: number | null = best.similarity;
    let reason: string | null = null;
    let matchedToBeId: string | null = null;

    try {
      const confirmation = await callClaudeStep<AlignmentConfirmation>(
        'You are a functional specification analyst performing alignment. Return only the JSON object specified.',
        buildAlignmentConfirmationPrompt(
          JSON.stringify(
            { title: asIs.title, type: asIs.type, description: asIs.description },
            null,
            2
          ),
          JSON.stringify(
            { title: best.component.title, type: best.component.type, description: best.component.description },
            null,
            2
          )
        ),
        0,
        200
      );

      if (confirmation?.match === true) {
        matchType = 'confirmed';
        confidence = confirmation.confidence ?? best.similarity;
        reason = confirmation.reason ?? null;
        matchedToBeId = best.component.id;
        matchedToBeIds.add(best.component.id);
      } else {
        matchType = 'rejected';
        reason = confirmation?.reason ?? null;
      }
    } catch {
      // Fallback: accept high-confidence similarity match if Claude is unavailable
      if (best.similarity >= 0.85) {
        matchType = 'confirmed';
        matchedToBeId = best.component.id;
        matchedToBeIds.add(best.component.id);
      }
    }

    const pair: AlignmentPair = {
      id: uuidv4(),
      run_id: runId,
      as_is_component_id: asIs.id,
      to_be_component_id: matchedToBeId,
      match_type: matchedToBeId ? matchType : 'unmatched_asis',
      confidence,
      match_reason: reason,
    };
    insertAlignmentPair(pair);
    pairs.push(pair);
  }

  for (const toBe of toBeComponents) {
    if (!matchedToBeIds.has(toBe.id)) {
      const pair: AlignmentPair = {
        id: uuidv4(),
        run_id: runId,
        as_is_component_id: null,
        to_be_component_id: toBe.id,
        match_type: 'unmatched_tobe',
        confidence: null,
        match_reason: null,
      };
      insertAlignmentPair(pair);
      pairs.push(pair);
    }
  }

  return pairs;
}
