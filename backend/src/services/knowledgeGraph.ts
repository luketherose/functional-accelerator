/**
 * Knowledge Graph — entity and relation storage layer.
 *
 * The graph is built incrementally from uploaded documents by the enrichment
 * pipeline. It is NOT required for basic retrieval (hybrid search works
 * without it); it provides a complementary structured memory for:
 *   - dependency tracing (what screens are affected by this rule?)
 *   - multi-hop reasoning (screen → field → API → object)
 *   - impact analysis expansion (find all artifacts downstream of a change)
 *
 * Storage: `kg_entities` and `kg_relations` SQLite tables.
 *
 * Entity types (aligned with the spec):
 *   capability | rule | screen | field | api | process | actor | object | report
 *
 * Relation types:
 *   contains | modifies | calls | depends_on | references | affects | produces
 *
 * Export surface:
 *   upsertEntities()     — bulk insert/update extracted entities
 *   upsertRelations()    — bulk insert/update extracted relations
 *   getEntitiesByProject() — list all entities for a project
 *   expandFromChunks()   — find entities linked to a set of chunk IDs (for graph expansion at query time)
 *   graphNeighbours()    — 1–2 hop neighbourhood traversal from entity IDs
 *   formatGraphContext() — render graph context for prompt injection
 */

import { v4 as uuidv4 } from 'uuid';
import db from '../db';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntityType =
  | 'capability'
  | 'rule'
  | 'screen'
  | 'field'
  | 'api'
  | 'process'
  | 'actor'
  | 'object'
  | 'report';

export type RelationType =
  | 'contains'
  | 'modifies'
  | 'calls'
  | 'depends_on'
  | 'references'
  | 'affects'
  | 'produces';

export interface KGEntity {
  id: string;
  project_id: string;
  file_id: string | null;
  chunk_id: string | null;
  entity_type: EntityType;
  name: string;
  description: string | null;
  source_quote: string | null;
  section_path: string | null;
  confidence: number;
  created_at: string;
}

export interface KGRelation {
  id: string;
  project_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: RelationType;
  confidence: number;
  source_quote: string | null;
  created_at: string;
}

export interface EntityInput {
  entity_type: EntityType;
  name: string;
  description?: string;
  source_quote?: string;
  section_path?: string;
  confidence?: number;
  file_id?: string;
  chunk_id?: string;
}

export interface RelationInput {
  source_name: string;
  target_name: string;
  relation_type: RelationType;
  confidence?: number;
  source_quote?: string;
}

// ─── Write operations ─────────────────────────────────────────────────────────

/**
 * Bulk upsert extracted entities for a project/file.
 * Deduplicates on (project_id, entity_type, LOWER(name)).
 * Returns map of name → id for relation linking.
 */
export function upsertEntities(
  projectId: string,
  entities: EntityInput[]
): Map<string, string> {
  const nameToId = new Map<string, string>();

  const findExisting = db.prepare(
    'SELECT id FROM kg_entities WHERE project_id = ? AND entity_type = ? AND LOWER(name) = LOWER(?)'
  );
  const insert = db.prepare(`
    INSERT INTO kg_entities (id, project_id, file_id, chunk_id, entity_type, name, description, source_quote, section_path, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE kg_entities SET
      description  = COALESCE(?, description),
      source_quote = COALESCE(?, source_quote),
      confidence   = MAX(confidence, ?)
    WHERE id = ?
  `);

  const run = db.transaction(() => {
    for (const e of entities) {
      const existing = findExisting.get(projectId, e.entity_type, e.name) as { id: string } | undefined;
      if (existing) {
        update.run(e.description ?? null, e.source_quote ?? null, e.confidence ?? 0.8, existing.id);
        nameToId.set(e.name.toLowerCase(), existing.id);
      } else {
        const id = uuidv4();
        insert.run(
          id, projectId, e.file_id ?? null, e.chunk_id ?? null,
          e.entity_type, e.name, e.description ?? null,
          e.source_quote ?? null, e.section_path ?? null,
          e.confidence ?? 0.8
        );
        nameToId.set(e.name.toLowerCase(), id);
      }
    }
  });

  run();
  return nameToId;
}

/**
 * Bulk upsert relations. Requires entity names to already be in DB.
 * Silently skips if either endpoint isn't found.
 */
export function upsertRelations(
  projectId: string,
  relations: RelationInput[],
  nameToId: Map<string, string>
): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO kg_relations (id, project_id, source_entity_id, target_entity_id, relation_type, confidence, source_quote)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    for (const r of relations) {
      const srcId = nameToId.get(r.source_name.toLowerCase());
      const tgtId = nameToId.get(r.target_name.toLowerCase());
      if (!srcId || !tgtId || srcId === tgtId) continue;
      insert.run(
        uuidv4(), projectId, srcId, tgtId,
        r.relation_type, r.confidence ?? 0.7,
        r.source_quote ?? null
      );
    }
  });

  run();
}

// ─── Read operations ──────────────────────────────────────────────────────────

export function getEntitiesByProject(projectId: string): KGEntity[] {
  return db.prepare('SELECT * FROM kg_entities WHERE project_id = ? ORDER BY entity_type, name')
    .all(projectId) as KGEntity[];
}

export function getEntityCount(projectId: string): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM kg_entities WHERE project_id = ?')
    .get(projectId) as { c: number };
  return row.c;
}

/**
 * Given a list of chunk IDs, find entities that were extracted from those chunks.
 */
export function getEntitiesForChunks(chunkIds: string[]): KGEntity[] {
  if (chunkIds.length === 0) return [];
  const placeholders = chunkIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM kg_entities WHERE chunk_id IN (${placeholders})`
  ).all(...chunkIds) as KGEntity[];
}

/**
 * 1–2 hop BFS from a set of entity IDs.
 * Returns all unique entities reachable within `maxHops` hops, plus the relations traversed.
 */
export function graphNeighbours(
  entityIds: string[],
  maxHops = 2
): { entities: KGEntity[]; relations: KGRelation[] } {
  if (entityIds.length === 0) return { entities: [], relations: [] };

  const visitedEntities = new Set<string>(entityIds);
  const visitedRelations = new Set<string>();
  const foundEntities: KGEntity[] = [];
  const foundRelations: KGRelation[] = [];

  let frontier = [...entityIds];

  for (let hop = 0; hop < maxHops; hop++) {
    if (frontier.length === 0) break;

    const placeholders = frontier.map(() => '?').join(',');
    const relations = db.prepare(`
      SELECT * FROM kg_relations
      WHERE source_entity_id IN (${placeholders})
         OR target_entity_id IN (${placeholders})
    `).all(...frontier, ...frontier) as KGRelation[];

    const nextFrontier: string[] = [];

    for (const rel of relations) {
      if (visitedRelations.has(rel.id)) continue;
      visitedRelations.add(rel.id);
      foundRelations.push(rel);

      for (const eid of [rel.source_entity_id, rel.target_entity_id]) {
        if (!visitedEntities.has(eid)) {
          visitedEntities.add(eid);
          nextFrontier.push(eid);
        }
      }
    }

    // Fetch new entities
    if (nextFrontier.length > 0) {
      const ePlaceholders = nextFrontier.map(() => '?').join(',');
      const newEntities = db.prepare(
        `SELECT * FROM kg_entities WHERE id IN (${ePlaceholders})`
      ).all(...nextFrontier) as KGEntity[];
      foundEntities.push(...newEntities);
    }

    frontier = nextFrontier;
  }

  return { entities: foundEntities, relations: foundRelations };
}

// ─── Prompt formatting ────────────────────────────────────────────────────────

/**
 * Render the graph context (entities + relations) as a prompt-ready text block.
 * Kept compact — used as supplementary context alongside retrieved chunks.
 */
export function formatGraphContext(
  entities: KGEntity[],
  relations: KGRelation[],
  entityIndex: Map<string, KGEntity>
): string {
  if (entities.length === 0 && relations.length === 0) return '';

  const lines: string[] = ['## Knowledge Graph Context\n'];

  if (entities.length > 0) {
    lines.push('### Entities\n');
    for (const e of entities.slice(0, 40)) {
      lines.push(`- **${e.entity_type}** — ${e.name}${e.description ? ': ' + e.description : ''}`);
    }
    lines.push('');
  }

  if (relations.length > 0) {
    lines.push('### Relationships\n');
    for (const r of relations.slice(0, 60)) {
      const src = entityIndex.get(r.source_entity_id)?.name ?? r.source_entity_id;
      const tgt = entityIndex.get(r.target_entity_id)?.name ?? r.target_entity_id;
      lines.push(`- ${src} **${r.relation_type}** ${tgt}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build an entity index (id → entity) for efficient relation rendering.
 */
export function buildEntityIndex(entities: KGEntity[]): Map<string, KGEntity> {
  return new Map(entities.map(e => [e.id, e]));
}
