/**
 * Graph Domain Service — domain-isolated graph governance.
 *
 * Manages two completely separate intelligence domains:
 *   - 'functional': entities/relations for Functional Analysis
 *   - 'risk':       entities/relations for Risk Analysis
 *
 * Each domain has its own:
 *   - ontology (entity type config)
 *   - suggestion queue (pending auto-discoveries)
 *   - approved entity registry
 *   - governance memory (persisted feedback)
 *   - operating mode (manual | assisted | auto)
 *
 * Domains NEVER share entities, suggestions, or memory.
 */

import { v4 as uuidv4 } from 'uuid';
import db from '../db';

// ─── Domain types ─────────────────────────────────────────────────────────────

export type GraphDomain = 'functional' | 'risk';
export type GraphMode = 'manual' | 'assisted' | 'auto';
export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'merged' | 'ignored';
export type MemoryType = 'reject_pattern' | 'merge_canonical' | 'reclassify' | 'always_ignore' | 'rename';

// ─── Base ontologies ──────────────────────────────────────────────────────────

export const FUNCTIONAL_BASE_TYPES: Omit<EntityTypeConfig, 'id' | 'project_id' | 'domain' | 'created_at' | 'updated_at'>[] = [
  { type_key: 'screen',         display_label: 'Screen',         description: 'UI screen or page',                         discoverable: true, enabled: true, is_base: true, sort_order: 1 },
  { type_key: 'form',           display_label: 'Form',           description: 'Input form or dialog',                      discoverable: true, enabled: true, is_base: true, sort_order: 2 },
  { type_key: 'field',          display_label: 'Field',          description: 'Data field or input attribute',             discoverable: true, enabled: true, is_base: true, sort_order: 3 },
  { type_key: 'api',            display_label: 'API',            description: 'API endpoint or external integration',      discoverable: true, enabled: true, is_base: true, sort_order: 4 },
  { type_key: 'process',        display_label: 'Process',        description: 'Business process or workflow',              discoverable: true, enabled: true, is_base: true, sort_order: 5 },
  { type_key: 'business_rule',  display_label: 'Business Rule',  description: 'Business constraint or rule',               discoverable: true, enabled: true, is_base: true, sort_order: 6 },
  { type_key: 'workflow_step',  display_label: 'Workflow Step',  description: 'Step within a workflow or process',         discoverable: true, enabled: true, is_base: true, sort_order: 7 },
  { type_key: 'batch_job',      display_label: 'Batch Job',      description: 'Scheduled or batch processing job',         discoverable: true, enabled: true, is_base: true, sort_order: 8 },
  { type_key: 'data_entity',    display_label: 'Data Entity',    description: 'Table, data entity or business object',     discoverable: true, enabled: true, is_base: true, sort_order: 9 },
  { type_key: 'event',          display_label: 'Event / Message','description': 'Domain event or message',                 discoverable: true, enabled: true, is_base: true, sort_order: 10 },
  { type_key: 'document',       display_label: 'Document',       description: 'Report, output or document artifact',       discoverable: true, enabled: true, is_base: true, sort_order: 11 },
];

export const RISK_BASE_TYPES: Omit<EntityTypeConfig, 'id' | 'project_id' | 'domain' | 'created_at' | 'updated_at'>[] = [
  { type_key: 'risk',           display_label: 'Risk',            description: 'Identified risk',                          discoverable: true, enabled: true, is_base: true, sort_order: 1 },
  { type_key: 'control',        display_label: 'Control',         description: 'Control measure',                          discoverable: true, enabled: true, is_base: true, sort_order: 2 },
  { type_key: 'requirement',    display_label: 'Requirement',     description: 'Compliance or functional requirement',      discoverable: true, enabled: true, is_base: true, sort_order: 3 },
  { type_key: 'regulation',     display_label: 'Regulation',      description: 'Regulatory obligation or law',              discoverable: true, enabled: true, is_base: true, sort_order: 4 },
  { type_key: 'evidence',       display_label: 'Evidence',        description: 'Evidence artifact supporting a control',    discoverable: true, enabled: true, is_base: true, sort_order: 5 },
  { type_key: 'mitigation',     display_label: 'Mitigation',      description: 'Risk mitigation or remediation action',     discoverable: true, enabled: true, is_base: true, sort_order: 6 },
  { type_key: 'process',        display_label: 'Process',         description: 'Business process relevant to risk',         discoverable: true, enabled: true, is_base: true, sort_order: 7 },
  { type_key: 'asset',          display_label: 'Asset',           description: 'Business or technical asset at risk',       discoverable: true, enabled: true, is_base: true, sort_order: 8 },
  { type_key: 'data_class',     display_label: 'Data Class',      description: 'Class of data (e.g. PII, financial)',       discoverable: true, enabled: true, is_base: true, sort_order: 9 },
  { type_key: 'finding',        display_label: 'Finding',         description: 'Audit finding or identified issue',         discoverable: true, enabled: true, is_base: true, sort_order: 10 },
  { type_key: 'issue',          display_label: 'Issue',           description: 'Known issue or defect',                    discoverable: true, enabled: true, is_base: true, sort_order: 11 },
  { type_key: 'document',       display_label: 'Document',        description: 'Policy, procedure or evidence document',    discoverable: true, enabled: true, is_base: true, sort_order: 12 },
];

// ─── DB row shapes ─────────────────────────────────────────────────────────────

export interface EntityTypeConfig {
  id: string;
  project_id: string;
  domain: GraphDomain;
  type_key: string;
  display_label: string;
  description: string | null;
  discoverable: boolean;
  enabled: boolean;
  is_base: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface GraphSuggestion {
  id: string;
  project_id: string;
  domain: GraphDomain;
  suggestion_type: 'entity' | 'relation';
  entity_type: string;
  name: string;
  description: string | null;
  source_quote: string | null;
  section_path: string | null;
  file_id: string | null;
  chunk_id: string | null;
  confidence: number;
  occurrence_count: number;
  source_docs: string[];
  why_suggested: string | null;
  status: SuggestionStatus;
  resolved_at: string | null;
  resolved_action: string | null;
  merged_into_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface GraphRelationSuggestion {
  id: string;
  project_id: string;
  domain: GraphDomain;
  source_entity_name: string;
  target_entity_name: string;
  source_entity_id: string | null;
  target_entity_id: string | null;
  relation_type: string;
  confidence: number;
  source_quote: string | null;
  status: SuggestionStatus;
  resolved_at: string | null;
  created_at: string;
}

export interface KGEntityRow {
  id: string;
  project_id: string;
  domain: GraphDomain;
  entity_type: string;
  name: string;
  description: string | null;
  source_quote: string | null;
  section_path: string | null;
  confidence: number;
  occurrence_count: number;
  source_count: number;
  relation_count: number;
  created_at: string;
  updated_at: string;
}

export interface KGRelationRow {
  id: string;
  project_id: string;
  domain: GraphDomain;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  confidence: number;
  source_quote: string | null;
  created_at: string;
}

export interface GovernanceMemory {
  id: string;
  project_id: string;
  domain: GraphDomain;
  memory_type: MemoryType;
  pattern: string;
  action: string;
  canonical: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DomainSettings {
  id: string;
  project_id: string;
  domain: GraphDomain;
  mode: GraphMode;
  created_at: string;
  updated_at: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function getDomainSettings(projectId: string, domain: GraphDomain): DomainSettings {
  const existing = db.prepare(
    'SELECT * FROM graph_domain_settings WHERE project_id = ? AND domain = ?'
  ).get(projectId, domain) as DomainSettings | undefined;

  if (existing) return existing;

  const id = uuidv4();
  db.prepare(
    'INSERT INTO graph_domain_settings (id, project_id, domain, mode) VALUES (?, ?, ?, ?)'
  ).run(id, projectId, domain, 'assisted');

  return db.prepare(
    'SELECT * FROM graph_domain_settings WHERE project_id = ? AND domain = ?'
  ).get(projectId, domain) as DomainSettings;
}

export function setDomainMode(projectId: string, domain: GraphDomain, mode: GraphMode): void {
  db.prepare(`
    INSERT INTO graph_domain_settings (id, project_id, domain, mode)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id, domain) DO UPDATE SET mode = excluded.mode, updated_at = datetime('now')
  `).run(uuidv4(), projectId, domain, mode);
}

// ─── Ontology management ──────────────────────────────────────────────────────

interface EntityTypeConfigRow {
  id: string; project_id: string; domain: string; type_key: string;
  display_label: string; description: string | null;
  discoverable: number; enabled: number; is_base: number;
  sort_order: number; created_at: string; updated_at: string;
}

export function getEntityTypeConfig(projectId: string, domain: GraphDomain): EntityTypeConfig[] {
  const rows = db.prepare(
    'SELECT * FROM graph_entity_type_config WHERE project_id = ? AND domain = ? ORDER BY sort_order'
  ).all(projectId, domain) as EntityTypeConfigRow[];

  if (rows.length === 0) {
    seedBaseTypes(projectId, domain);
    return getEntityTypeConfig(projectId, domain);
  }

  return rows.map(r => ({
    ...r,
    domain: r.domain as GraphDomain,
    discoverable: Boolean(r.discoverable),
    enabled: Boolean(r.enabled),
    is_base: Boolean(r.is_base),
  }));
}

function seedBaseTypes(projectId: string, domain: GraphDomain): void {
  const base = domain === 'functional' ? FUNCTIONAL_BASE_TYPES : RISK_BASE_TYPES;
  const ins = db.prepare(`
    INSERT OR IGNORE INTO graph_entity_type_config
      (id, project_id, domain, type_key, display_label, description, discoverable, enabled, is_base, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const t of base) {
      ins.run(uuidv4(), projectId, domain, t.type_key, t.display_label, t.description ?? null,
        t.discoverable ? 1 : 0, t.enabled ? 1 : 0, t.is_base ? 1 : 0, t.sort_order);
    }
  });
  tx();
}

export function upsertEntityTypeConfig(
  projectId: string,
  domain: GraphDomain,
  typeKey: string,
  patch: Partial<Pick<EntityTypeConfig, 'display_label' | 'description' | 'discoverable' | 'enabled' | 'sort_order'>>
): void {
  const existing = db.prepare(
    'SELECT id FROM graph_entity_type_config WHERE project_id = ? AND domain = ? AND type_key = ?'
  ).get(projectId, domain, typeKey) as { id: string } | undefined;

  if (existing) {
    const sets: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];
    if (patch.display_label !== undefined) { sets.push('display_label = ?'); vals.push(patch.display_label); }
    if (patch.description !== undefined) { sets.push('description = ?'); vals.push(patch.description); }
    if (patch.discoverable !== undefined) { sets.push('discoverable = ?'); vals.push(patch.discoverable ? 1 : 0); }
    if (patch.enabled !== undefined) { sets.push('enabled = ?'); vals.push(patch.enabled ? 1 : 0); }
    if (patch.sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(patch.sort_order); }
    vals.push(existing.id);
    db.prepare(`UPDATE graph_entity_type_config SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  } else {
    db.prepare(`
      INSERT INTO graph_entity_type_config (id, project_id, domain, type_key, display_label, description, discoverable, enabled, is_base, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      uuidv4(), projectId, domain, typeKey,
      patch.display_label ?? typeKey,
      patch.description ?? null,
      patch.discoverable !== false ? 1 : 0,
      patch.enabled !== false ? 1 : 0,
      patch.sort_order ?? 99
    );
  }
}

export function addEntityTypeConfig(
  projectId: string,
  domain: GraphDomain,
  typeKey: string,
  displayLabel: string,
  description?: string
): void {
  const maxOrder = (db.prepare(
    'SELECT MAX(sort_order) as m FROM graph_entity_type_config WHERE project_id = ? AND domain = ?'
  ).get(projectId, domain) as { m: number | null }).m ?? 0;

  db.prepare(`
    INSERT OR IGNORE INTO graph_entity_type_config (id, project_id, domain, type_key, display_label, description, discoverable, enabled, is_base, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0, ?)
  `).run(uuidv4(), projectId, domain, typeKey, displayLabel, description ?? null, maxOrder + 1);
}

// ─── Suggestion management ────────────────────────────────────────────────────

export interface SuggestionInput {
  entity_type: string;
  name: string;
  description?: string;
  source_quote?: string;
  section_path?: string;
  file_id?: string;
  chunk_id?: string;
  confidence?: number;
  source_docs?: string[];
  why_suggested?: string;
}

/**
 * Create or accumulate a suggestion for an entity.
 * If a pending suggestion with the same (project, domain, name, entity_type) already exists,
 * increments occurrence_count instead of inserting a duplicate.
 */
export function createSuggestion(
  projectId: string,
  domain: GraphDomain,
  input: SuggestionInput
): void {
  const existing = db.prepare(
    `SELECT id, occurrence_count, source_docs FROM graph_suggestions
     WHERE project_id = ? AND domain = ? AND LOWER(name) = LOWER(?) AND entity_type = ? AND status = 'pending'`
  ).get(projectId, domain, input.name, input.entity_type) as
    { id: string; occurrence_count: number; source_docs: string } | undefined;

  if (existing) {
    const docs: string[] = JSON.parse(existing.source_docs);
    const newDocs = input.source_docs ?? [];
    const merged = Array.from(new Set([...docs, ...newDocs]));
    db.prepare(`
      UPDATE graph_suggestions
      SET occurrence_count = occurrence_count + 1,
          source_docs = ?,
          confidence  = MAX(confidence, ?),
          updated_at  = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(merged), input.confidence ?? 0.8, existing.id);
    return;
  }

  db.prepare(`
    INSERT INTO graph_suggestions
      (id, project_id, domain, suggestion_type, entity_type, name, description, source_quote, section_path, file_id, chunk_id, confidence, occurrence_count, source_docs, why_suggested)
    VALUES (?, ?, ?, 'entity', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    uuidv4(), projectId, domain,
    input.entity_type, input.name,
    input.description ?? null, input.source_quote ?? null,
    input.section_path ?? null, input.file_id ?? null, input.chunk_id ?? null,
    input.confidence ?? 0.8,
    JSON.stringify(input.source_docs ?? []),
    input.why_suggested ?? null
  );
}

export function getSuggestions(
  projectId: string,
  domain: GraphDomain,
  status: SuggestionStatus = 'pending'
): GraphSuggestion[] {
  const rows = db.prepare(
    `SELECT * FROM graph_suggestions WHERE project_id = ? AND domain = ? AND status = ? ORDER BY confidence DESC, occurrence_count DESC`
  ).all(projectId, domain, status) as (Omit<GraphSuggestion, 'source_docs'> & { source_docs: string })[];
  return rows.map(r => ({ ...r, source_docs: JSON.parse(r.source_docs) }));
}

export function approveSuggestion(
  suggestionId: string,
  projectId: string,
  domain: GraphDomain,
  overrides?: { name?: string; entity_type?: string }
): string {
  const suggestion = db.prepare('SELECT * FROM graph_suggestions WHERE id = ? AND project_id = ? AND domain = ?')
    .get(suggestionId, projectId, domain) as (Omit<GraphSuggestion, 'source_docs'> & { source_docs: string }) | undefined;
  if (!suggestion) throw new Error('Suggestion not found');

  const name = overrides?.name ?? suggestion.name;
  const entityType = overrides?.entity_type ?? suggestion.entity_type;

  const existing = db.prepare(
    `SELECT id FROM kg_entities WHERE project_id = ? AND domain = ? AND LOWER(name) = LOWER(?) AND entity_type = ?`
  ).get(projectId, domain, name, entityType) as { id: string } | undefined;

  let entityId: string;
  if (existing) {
    entityId = existing.id;
    db.prepare(`UPDATE kg_entities SET occurrence_count = occurrence_count + ?, updated_at = datetime('now') WHERE id = ?`)
      .run(suggestion.occurrence_count, entityId);
  } else {
    entityId = uuidv4();
    db.prepare(`
      INSERT INTO kg_entities (id, project_id, domain, entity_type, name, description, source_quote, section_path, confidence, occurrence_count, file_id, chunk_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityId, projectId, domain, entityType, name,
      suggestion.description, suggestion.source_quote, suggestion.section_path,
      suggestion.confidence, suggestion.occurrence_count,
      suggestion.file_id, suggestion.chunk_id
    );
  }

  db.prepare(`
    UPDATE graph_suggestions SET status = 'approved', resolved_at = datetime('now'), resolved_action = 'approved', updated_at = datetime('now') WHERE id = ?
  `).run(suggestionId);

  return entityId;
}

export function rejectSuggestion(suggestionId: string, projectId: string, domain: GraphDomain, alwaysIgnore = false): void {
  const s = db.prepare('SELECT * FROM graph_suggestions WHERE id = ? AND project_id = ? AND domain = ?')
    .get(suggestionId, projectId, domain) as GraphSuggestion | undefined;
  if (!s) throw new Error('Suggestion not found');

  db.prepare(`
    UPDATE graph_suggestions SET status = 'rejected', resolved_at = datetime('now'), resolved_action = ?, updated_at = datetime('now') WHERE id = ?
  `).run(alwaysIgnore ? 'always_ignore' : 'rejected', suggestionId);

  if (alwaysIgnore) {
    persistMemory(projectId, domain, 'always_ignore', s.name.toLowerCase(), 'ignore', undefined);
  }
}

export function mergeSuggestion(
  suggestionId: string,
  projectId: string,
  domain: GraphDomain,
  targetEntityId: string
): void {
  const s = db.prepare('SELECT * FROM graph_suggestions WHERE id = ? AND project_id = ? AND domain = ?')
    .get(suggestionId, projectId, domain) as GraphSuggestion | undefined;
  if (!s) throw new Error('Suggestion not found');

  const target = db.prepare('SELECT id, name FROM kg_entities WHERE id = ? AND project_id = ? AND domain = ?')
    .get(targetEntityId, projectId, domain) as { id: string; name: string } | undefined;
  if (!target) throw new Error('Target entity not found');

  db.prepare(`UPDATE kg_entities SET occurrence_count = occurrence_count + ?, updated_at = datetime('now') WHERE id = ?`)
    .run(s.occurrence_count, targetEntityId);

  db.prepare(`
    UPDATE graph_suggestions SET status = 'merged', resolved_at = datetime('now'), merged_into_id = ?, resolved_action = 'merged', updated_at = datetime('now') WHERE id = ?
  `).run(targetEntityId, suggestionId);

  persistMemory(projectId, domain, 'merge_canonical', s.name.toLowerCase(), 'merge', target.name);
}

// ─── Entity registry ──────────────────────────────────────────────────────────

export function getEntities(
  projectId: string,
  domain: GraphDomain,
  opts: { type?: string; search?: string; limit?: number; offset?: number } = {}
): { entities: KGEntityRow[]; total: number } {
  const conditions = ['e.project_id = ?', 'e.domain = ?'];
  const params: unknown[] = [projectId, domain];

  if (opts.type) { conditions.push('e.entity_type = ?'); params.push(opts.type); }
  if (opts.search) { conditions.push("LOWER(e.name) LIKE LOWER(?)"); params.push(`%${opts.search}%`); }

  const where = conditions.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) as c FROM kg_entities e WHERE ${where}`).get(...params) as { c: number }).c;

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const rows = db.prepare(`
    SELECT e.*, COUNT(DISTINCT kr1.id) + COUNT(DISTINCT kr2.id) as computed_relation_count
    FROM kg_entities e
    LEFT JOIN kg_relations kr1 ON kr1.source_entity_id = e.id
    LEFT JOIN kg_relations kr2 ON kr2.target_entity_id = e.id
    WHERE ${where}
    GROUP BY e.id
    ORDER BY e.entity_type, e.name
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as (KGEntityRow & { computed_relation_count: number })[];

  return {
    entities: rows.map(r => ({ ...r, relation_count: r.computed_relation_count })),
    total
  };
}

export function updateEntity(
  entityId: string,
  projectId: string,
  domain: GraphDomain,
  patch: Partial<Pick<KGEntityRow, 'name' | 'entity_type' | 'description'>>
): void {
  const entity = db.prepare('SELECT * FROM kg_entities WHERE id = ? AND project_id = ? AND domain = ?')
    .get(entityId, projectId, domain) as KGEntityRow | undefined;
  if (!entity) throw new Error('Entity not found');

  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name); }
  if (patch.entity_type !== undefined) { sets.push('entity_type = ?'); vals.push(patch.entity_type); }
  if (patch.description !== undefined) { sets.push('description = ?'); vals.push(patch.description); }
  vals.push(entityId);
  db.prepare(`UPDATE kg_entities SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  if (patch.name && patch.name !== entity.name) {
    persistMemory(projectId, domain, 'rename', entity.name.toLowerCase(), 'rename', patch.name);
  }
  if (patch.entity_type && patch.entity_type !== entity.entity_type) {
    persistMemory(projectId, domain, 'reclassify', entity.name.toLowerCase(), 'reclassify', patch.entity_type);
  }
}

export function deleteEntity(entityId: string, projectId: string, domain: GraphDomain): void {
  const entity = db.prepare('SELECT name FROM kg_entities WHERE id = ? AND project_id = ? AND domain = ?')
    .get(entityId, projectId, domain) as { name: string } | undefined;
  if (!entity) return;

  db.prepare('DELETE FROM kg_entities WHERE id = ? AND project_id = ? AND domain = ?').run(entityId, projectId, domain);

  persistMemory(projectId, domain, 'reject_pattern', entity.name.toLowerCase(), 'delete', undefined);
}

export function mergeEntities(
  sourceEntityId: string,
  targetEntityId: string,
  projectId: string,
  domain: GraphDomain
): void {
  const source = db.prepare('SELECT * FROM kg_entities WHERE id = ? AND project_id = ? AND domain = ?')
    .get(sourceEntityId, projectId, domain) as KGEntityRow | undefined;
  const target = db.prepare('SELECT * FROM kg_entities WHERE id = ? AND project_id = ? AND domain = ?')
    .get(targetEntityId, projectId, domain) as KGEntityRow | undefined;
  if (!source || !target) throw new Error('Entity not found');

  db.prepare('UPDATE kg_relations SET source_entity_id = ? WHERE source_entity_id = ?').run(targetEntityId, sourceEntityId);
  db.prepare('UPDATE kg_relations SET target_entity_id = ? WHERE target_entity_id = ?').run(targetEntityId, sourceEntityId);
  db.prepare(`UPDATE kg_entities SET occurrence_count = occurrence_count + ?, updated_at = datetime('now') WHERE id = ?`)
    .run(source.occurrence_count, targetEntityId);
  db.prepare('DELETE FROM kg_entities WHERE id = ?').run(sourceEntityId);

  persistMemory(projectId, domain, 'merge_canonical', source.name.toLowerCase(), 'merge', target.name);
}

// ─── Relation registry ────────────────────────────────────────────────────────

export function getRelations(
  projectId: string,
  domain: GraphDomain,
  opts: { entityId?: string; limit?: number; offset?: number } = {}
): { relations: (KGRelationRow & { source_name: string; target_name: string })[]; total: number } {
  const conditions = ['r.project_id = ?', 'r.domain = ?'];
  const params: unknown[] = [projectId, domain];

  if (opts.entityId) {
    conditions.push('(r.source_entity_id = ? OR r.target_entity_id = ?)');
    params.push(opts.entityId, opts.entityId);
  }

  const where = conditions.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) as c FROM kg_relations r WHERE ${where}`).get(...params) as { c: number }).c;

  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const rows = db.prepare(`
    SELECT r.*, se.name as source_name, te.name as target_name
    FROM kg_relations r
    JOIN kg_entities se ON se.id = r.source_entity_id
    JOIN kg_entities te ON te.id = r.target_entity_id
    WHERE ${where}
    ORDER BY r.confidence DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as (KGRelationRow & { source_name: string; target_name: string })[];

  return { relations: rows, total };
}

export function deleteRelation(relationId: string, projectId: string, domain: GraphDomain): void {
  db.prepare('DELETE FROM kg_relations WHERE id = ? AND project_id = ? AND domain = ?').run(relationId, projectId, domain);
}

// ─── Graph data for visualization ─────────────────────────────────────────────

export function getGraphData(
  projectId: string,
  domain: GraphDomain,
  opts: { typeFilter?: string[]; minConfidence?: number; limit?: number } = {}
): { nodes: KGEntityRow[]; edges: (KGRelationRow & { source_name: string; target_name: string })[] } {
  const conditions = ['e.project_id = ?', 'e.domain = ?'];
  const params: unknown[] = [projectId, domain];

  if (opts.typeFilter && opts.typeFilter.length > 0) {
    conditions.push(`e.entity_type IN (${opts.typeFilter.map(() => '?').join(',')})`);
    params.push(...opts.typeFilter);
  }
  if (opts.minConfidence !== undefined) {
    conditions.push('e.confidence >= ?');
    params.push(opts.minConfidence);
  }

  const limit = opts.limit ?? 200;
  const nodes = db.prepare(`
    SELECT * FROM kg_entities e WHERE ${conditions.join(' AND ')} ORDER BY e.confidence DESC LIMIT ?
  `).all(...params, limit) as KGEntityRow[];

  if (nodes.length === 0) return { nodes: [], edges: [] };

  const nodeIds = nodes.map(n => n.id);
  const placeholders = nodeIds.map(() => '?').join(',');
  const edges = db.prepare(`
    SELECT r.*, se.name as source_name, te.name as target_name
    FROM kg_relations r
    JOIN kg_entities se ON se.id = r.source_entity_id
    JOIN kg_entities te ON te.id = r.target_entity_id
    WHERE r.project_id = ? AND r.domain = ?
      AND r.source_entity_id IN (${placeholders})
      AND r.target_entity_id IN (${placeholders})
  `).all(projectId, domain, ...nodeIds, ...nodeIds) as (KGRelationRow & { source_name: string; target_name: string })[];

  return { nodes, edges };
}

// ─── Governance memory ────────────────────────────────────────────────────────

function persistMemory(
  projectId: string,
  domain: GraphDomain,
  memoryType: MemoryType,
  pattern: string,
  action: string,
  canonical: string | undefined,
  metadata: Record<string, unknown> = {}
): void {
  db.prepare(`
    INSERT INTO graph_governance_memory (id, project_id, domain, memory_type, pattern, action, canonical, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, domain, memory_type, pattern) DO UPDATE SET
      action = excluded.action, canonical = excluded.canonical, metadata = excluded.metadata
  `).run(uuidv4(), projectId, domain, memoryType, pattern, action, canonical ?? null, JSON.stringify(metadata));
}

export function getGovernanceMemory(projectId: string, domain: GraphDomain): GovernanceMemory[] {
  const rows = db.prepare(
    'SELECT * FROM graph_governance_memory WHERE project_id = ? AND domain = ? ORDER BY created_at DESC'
  ).all(projectId, domain) as (Omit<GovernanceMemory, 'metadata'> & { metadata: string })[];
  return rows.map(r => ({ ...r, metadata: JSON.parse(r.metadata) }));
}

/**
 * Check if a proposed entity should be suppressed based on governance memory.
 * Returns { suppress: true } if the entity matches a reject/always_ignore pattern.
 * Returns { canonical: name } if the entity should be renamed/merged.
 */
export function checkGovernanceMemory(
  projectId: string,
  domain: GraphDomain,
  name: string
): { suppress: boolean; canonical?: string } {
  const rows = db.prepare(
    `SELECT * FROM graph_governance_memory WHERE project_id = ? AND domain = ? AND pattern = LOWER(?)`
  ).all(projectId, domain, name) as (Omit<GovernanceMemory, 'metadata'> & { metadata: string })[];

  for (const row of rows) {
    if (row.memory_type === 'reject_pattern' || row.memory_type === 'always_ignore') {
      return { suppress: true };
    }
    if ((row.memory_type === 'merge_canonical' || row.memory_type === 'rename') && row.canonical) {
      return { suppress: false, canonical: row.canonical };
    }
  }
  return { suppress: false };
}

// ─── Direct entity upsert (used in 'auto' mode) ───────────────────────────────

export function upsertDomainEntity(
  projectId: string,
  domain: GraphDomain,
  input: SuggestionInput
): string {
  const mem = checkGovernanceMemory(projectId, domain, input.name);
  if (mem.suppress) return '';

  const name = mem.canonical ?? input.name;
  const existing = db.prepare(
    `SELECT id FROM kg_entities WHERE project_id = ? AND domain = ? AND LOWER(name) = LOWER(?) AND entity_type = ?`
  ).get(projectId, domain, name, input.entity_type) as { id: string } | undefined;

  if (existing) {
    db.prepare(`UPDATE kg_entities SET occurrence_count = occurrence_count + 1, confidence = MAX(confidence, ?), updated_at = datetime('now') WHERE id = ?`)
      .run(input.confidence ?? 0.8, existing.id);
    return existing.id;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO kg_entities (id, project_id, domain, entity_type, name, description, source_quote, section_path, confidence, occurrence_count, file_id, chunk_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, projectId, domain, input.entity_type, name,
    input.description ?? null, input.source_quote ?? null,
    input.section_path ?? null, input.confidence ?? 0.8,
    input.file_id ?? null, input.chunk_id ?? null
  );
  return id;
}

export function upsertDomainRelation(
  projectId: string,
  domain: GraphDomain,
  sourceId: string,
  targetId: string,
  relationType: string,
  confidence = 0.7,
  sourceQuote?: string
): void {
  if (!sourceId || !targetId || sourceId === targetId) return;
  db.prepare(`
    INSERT OR IGNORE INTO kg_relations (id, project_id, domain, source_entity_id, target_entity_id, relation_type, confidence, source_quote)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), projectId, domain, sourceId, targetId, relationType, confidence, sourceQuote ?? null);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getDomainStats(projectId: string, domain: GraphDomain) {
  const entityCount = (db.prepare('SELECT COUNT(*) as c FROM kg_entities WHERE project_id = ? AND domain = ?').get(projectId, domain) as { c: number }).c;
  const relationCount = (db.prepare('SELECT COUNT(*) as c FROM kg_relations WHERE project_id = ? AND domain = ?').get(projectId, domain) as { c: number }).c;
  const pendingSuggestions = (db.prepare("SELECT COUNT(*) as c FROM graph_suggestions WHERE project_id = ? AND domain = ? AND status = 'pending'").get(projectId, domain) as { c: number }).c;
  const settings = getDomainSettings(projectId, domain);
  return { entityCount, relationCount, pendingSuggestions, mode: settings.mode };
}
