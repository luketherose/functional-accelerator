/**
 * Entity & relation extractor — uses Claude to identify domain entities and
 * relationships from a batch of document chunks.
 *
 * This runs AFTER the fast indexing path (embedding + FTS5) as part of the
 * progressive enrichment pipeline. It is NOT blocking for the user.
 *
 * Design:
 * - Takes up to 30 chunks from a file (the most content-rich ones)
 * - Calls Claude once per batch with a focused extraction prompt
 * - Parses the JSON response into EntityInput[] + RelationInput[]
 * - Persists via knowledgeGraph.upsertEntities / upsertRelations
 *
 * Mock mode: CLAUDE_MOCK=true returns empty extraction (no entities extracted,
 * no API call). The rest of the pipeline still works — graph context will just
 * be absent in mock mode.
 */

import db from '../db';
import { callClaudeStep } from './claude';
import { upsertEntities, upsertRelations, type EntityInput, type RelationInput } from './knowledgeGraph';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractionResponse {
  entities: EntityInput[];
  relations: RelationInput[];
}

// ─── Main extraction function ─────────────────────────────────────────────────

/**
 * Extract entities and relations from all chunks of a given file.
 * Processes in batches of MAX_CHUNKS_PER_BATCH to keep token usage bounded.
 */
export async function extractEntitiesFromFile(
  fileId: string,
  projectId: string
): Promise<{ entitiesFound: number; relationsFound: number }> {
  if (process.env.CLAUDE_MOCK === 'true') {
    return { entitiesFound: 0, relationsFound: 0 };
  }

  const chunks = db.prepare(
    `SELECT id, section_path, content, word_count
     FROM file_chunks
     WHERE file_id = ?
     ORDER BY word_count DESC
     LIMIT 30`
  ).all(fileId) as { id: string; section_path: string; content: string; word_count: number }[];

  if (chunks.length === 0) return { entitiesFound: 0, relationsFound: 0 };

  // Batch into groups of 10 to stay within token limits per call
  const BATCH = 10;
  let totalEntities = 0;
  let totalRelations = 0;

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    try {
      const result = await extractBatch(projectId, fileId, batch);
      totalEntities += result.entitiesFound;
      totalRelations += result.relationsFound;
    } catch (err) {
      console.warn(`[entityExtractor] Batch ${i / BATCH + 1} failed:`, err);
      // Continue with next batch — partial extraction is still useful
    }
  }

  return { entitiesFound: totalEntities, relationsFound: totalRelations };
}

// ─── Batch extraction ─────────────────────────────────────────────────────────

async function extractBatch(
  projectId: string,
  fileId: string,
  chunks: { id: string; section_path: string; content: string }[]
): Promise<{ entitiesFound: number; relationsFound: number }> {
  const chunkText = chunks
    .map((c, i) => `[Chunk ${i + 1} — ${c.section_path || 'Section'}]\n${c.content}`)
    .join('\n\n---\n\n');

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(chunkText);

  const result = await callClaudeStep<ExtractionResponse>(
    systemPrompt,
    userPrompt,
    0.0,   // temperature 0 for deterministic extraction
    4096   // entity extraction responses are compact
  );

  const entities: EntityInput[] = (result.entities ?? []).map(e => ({
    ...e,
    file_id: fileId,
    // Try to match chunk_id by section path proximity (best-effort)
    chunk_id: chunks.find(c => c.section_path === e.section_path)?.id ?? undefined,
  }));

  const relations: RelationInput[] = result.relations ?? [];

  if (entities.length === 0) return { entitiesFound: 0, relationsFound: 0 };

  const nameToId = upsertEntities(projectId, entities);
  upsertRelations(projectId, relations, nameToId);

  return { entitiesFound: entities.length, relationsFound: relations.length };
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a precise information extraction engine for enterprise functional analysis documents.

Your task is to identify domain entities and their relationships from document chunks.

Entity types you must recognize:
- capability: a functional capability or feature ("expense approval", "multi-currency support")
- rule: a business rule or constraint ("amount > 10000 requires manager approval")
- screen: a UI screen, page, or form ("Expense Entry Form", "Approval Dashboard")
- field: a data field or attribute ("Amount", "Currency Code", "Approval Status")
- api: an API, integration endpoint, or external service ("SAP connector", "Exchange Rate API")
- process: a workflow, process, or procedure ("Expense Submission Process", "Approval Workflow")
- actor: a user role, person, or system actor ("Finance Manager", "Approver", "Employee")
- object: a data entity or business object ("Expense Report", "Payment", "Budget Line")
- report: a report, document, or output artifact ("Monthly Expense Report", "Audit Trail")

Relation types you must recognize:
- contains: a parent entity contains a child (screen contains field, process contains step)
- modifies: one entity modifies/changes another (requirement modifies rule, process modifies object)
- calls: one entity invokes another (screen calls api, process calls api)
- depends_on: a dependency (process depends_on object, rule depends_on field)
- references: a soft reference or mention (document references document, rule references object)
- affects: a change or impact relationship (rule affects field, process affects actor)
- produces: an output relationship (process produces report, api produces object)

Rules:
- Extract only entities that are explicitly named or clearly identifiable
- Do not invent entities not present in the text
- Confidence should reflect how clearly the entity is stated (0.6–1.0)
- Return raw JSON only — no markdown, no prose

JSON schema:
{
  "entities": [
    {
      "entity_type": "screen | field | rule | ...",
      "name": "Exact entity name",
      "description": "Brief description (optional)",
      "source_quote": "Short verbatim quote (optional)",
      "section_path": "Section where found (optional)",
      "confidence": 0.85
    }
  ],
  "relations": [
    {
      "source_name": "Entity A name",
      "target_name": "Entity B name",
      "relation_type": "contains | modifies | ...",
      "confidence": 0.8,
      "source_quote": "Short verbatim quote (optional)"
    }
  ]
}`;
}

function buildUserPrompt(chunkText: string): string {
  return `Extract all entities and relationships from the following document chunks.

${chunkText}

Return raw JSON only.`;
}
