/**
 * Functional Graph Extractor — extracts entities and relations for the
 * FUNCTIONAL domain from document chunks.
 *
 * Ontology: Screen, Form, Field, API, Process, Business Rule, Workflow Step,
 *   Batch Job, Data Entity, Event/Message, Document + auto-discovered types.
 *
 * Relations: CONTAINS, SUBMITS_TO, USES_RULE, TRIGGERS, MAPPED_TO,
 *   DEPENDS_ON, CALLS, PRODUCES, VALIDATES, REFERENCES
 *
 * Behavior depends on the domain mode:
 *   - manual:   no extraction at all
 *   - assisted: extracts → creates suggestions (default)
 *   - auto:     extracts → upserts directly to kg_entities
 */

import db from '../db';
import { callClaudeStep } from './claude';
import { getDomainSettings, createSuggestion, upsertDomainEntity, upsertDomainRelation, checkGovernanceMemory } from './graphDomainService';

interface ExtractedEntity {
  entity_type: string;
  name: string;
  description?: string;
  source_quote?: string;
  section_path?: string;
  confidence?: number;
}

interface ExtractedRelation {
  source_name: string;
  target_name: string;
  relation_type: string;
  confidence?: number;
  source_quote?: string;
}

interface ExtractionResponse {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

const SYSTEM_PROMPT = `You are a precise information extraction engine for enterprise functional analysis documents.

Extract entities and relationships that represent the FUNCTIONAL architecture of the described system.

Entity types to recognize:
- screen: A UI screen, page, or view ("Expense Entry Screen", "Dashboard")
- form: An input form, dialog, or panel ("Login Form", "Create Order Form")
- field: A data field, input, or attribute ("Amount", "Customer ID", "Status")
- api: An API endpoint, service, or external integration ("Payment Gateway API", "SAP Connector")
- process: A business process, workflow, or procedure ("Approval Process", "Order Fulfillment")
- business_rule: A business rule, constraint, or validation ("Amount > 1000 requires approval")
- workflow_step: A step within a process or workflow ("Submit for Approval", "Notify Manager")
- batch_job: A scheduled job, batch process, or async task ("Nightly Reconciliation Job")
- data_entity: A data entity, table, or business object ("Invoice", "Customer", "Order Line")
- event: A domain event, message, or notification ("Order Submitted Event", "Payment Received")
- document: A report, output artifact, or document ("Monthly Report", "Invoice PDF")

Relation types:
- contains: parent contains child (screen contains field, form contains field)
- submits_to: form/screen submits to api or process
- uses_rule: process/screen uses a business rule
- triggers: step/event triggers another step or process
- mapped_to: field is mapped to data entity or another field
- depends_on: entity depends on another
- calls: process/screen calls api
- produces: process/job produces document or data entity
- validates: rule validates field or data entity
- references: soft reference between entities

Rules:
- Extract only explicitly named or clearly identifiable entities
- Do not invent entities not present in the text
- Confidence 0.6–1.0 reflects how clearly the entity is stated
- Return raw JSON only — no markdown fences

JSON schema:
{
  "entities": [{"entity_type": "...", "name": "...", "description": "...", "source_quote": "...", "section_path": "...", "confidence": 0.85}],
  "relations": [{"source_name": "...", "target_name": "...", "relation_type": "...", "confidence": 0.8, "source_quote": "..."}]
}`;

export async function runFunctionalGraphExtraction(
  projectId: string,
  fileId: string
): Promise<{ entitiesFound: number; relationsFound: number }> {
  if (process.env.CLAUDE_MOCK === 'true') return { entitiesFound: 0, relationsFound: 0 };

  const settings = getDomainSettings(projectId, 'functional');
  if (settings.mode === 'manual') return { entitiesFound: 0, relationsFound: 0 };

  const chunks = db.prepare(
    `SELECT id, section_path, content, word_count FROM file_chunks WHERE file_id = ? ORDER BY word_count DESC LIMIT 30`
  ).all(fileId) as { id: string; section_path: string; content: string; word_count: number }[];

  if (chunks.length === 0) return { entitiesFound: 0, relationsFound: 0 };

  const file = db.prepare('SELECT original_name FROM files WHERE id = ?').get(fileId) as { original_name: string } | undefined;
  const sourceDocs = file ? [file.original_name] : [];

  const BATCH = 10;
  let totalEntities = 0;
  let totalRelations = 0;
  const nameToId = new Map<string, string>();

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    try {
      const result = await extractBatch(batch);
      const filtered = applyGovernanceFilter(projectId, result.entities);

      if (settings.mode === 'assisted') {
        for (const e of filtered) {
          createSuggestion(projectId, 'functional', {
            entity_type: e.entity_type,
            name: e.name,
            description: e.description,
            source_quote: e.source_quote,
            section_path: e.section_path,
            file_id: fileId,
            chunk_id: batch.find(c => c.section_path === e.section_path)?.id,
            confidence: e.confidence ?? 0.8,
            source_docs: sourceDocs,
            why_suggested: `Auto-discovered in ${e.section_path ?? 'document'} (functional analysis)`,
          });
        }
      } else {
        for (const e of filtered) {
          const id = upsertDomainEntity(projectId, 'functional', {
            entity_type: e.entity_type,
            name: e.name,
            description: e.description,
            source_quote: e.source_quote,
            section_path: e.section_path,
            file_id: fileId,
            chunk_id: batch.find(c => c.section_path === e.section_path)?.id,
            confidence: e.confidence ?? 0.8,
            source_docs: sourceDocs,
          });
          if (id) nameToId.set(e.name.toLowerCase(), id);
        }

        for (const r of result.relations) {
          const srcId = nameToId.get(r.source_name.toLowerCase());
          const tgtId = nameToId.get(r.target_name.toLowerCase());
          if (srcId && tgtId) {
            upsertDomainRelation(projectId, 'functional', srcId, tgtId, r.relation_type, r.confidence ?? 0.7, r.source_quote);
          }
        }
      }

      totalEntities += filtered.length;
      totalRelations += result.relations.length;
    } catch (err) {
      console.warn(`[functionalGraphExtractor] Batch failed:`, err);
    }
  }

  return { entitiesFound: totalEntities, relationsFound: totalRelations };
}

async function extractBatch(
  chunks: { id: string; section_path: string; content: string }[]
): Promise<ExtractionResponse> {
  const chunkText = chunks
    .map((c, i) => `[Chunk ${i + 1} — ${c.section_path || 'Section'}]\n${c.content}`)
    .join('\n\n---\n\n');

  const result = await callClaudeStep<ExtractionResponse>(
    SYSTEM_PROMPT,
    `Extract all functional entities and relationships from the following document chunks.\n\n${chunkText}\n\nReturn raw JSON only.`,
    0.0,
    4096
  );

  return {
    entities: result.entities ?? [],
    relations: result.relations ?? [],
  };
}

function applyGovernanceFilter(projectId: string, entities: ExtractedEntity[]): ExtractedEntity[] {
  return entities.filter(e => {
    const mem = checkGovernanceMemory(projectId, 'functional', e.name);
    return !mem.suppress;
  });
}
