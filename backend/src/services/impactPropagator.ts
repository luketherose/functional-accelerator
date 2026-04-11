import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { bfsTraverse } from './functionalMap';
import type { FunctionalGap, GapImpact } from '../types';

function buildGraphForVersions(versionIds: string[]): Map<string, string[]> {
  if (versionIds.length === 0) return new Map();

  const placeholders = versionIds.map(() => '?').join(',');
  const relationships = db.prepare(`
    SELECT cr.from_component_id, cr.to_component_id
    FROM component_relationships cr
    JOIN functional_components fc ON cr.from_component_id = fc.id
    WHERE fc.document_version_id IN (${placeholders})
  `).all(...versionIds) as Array<{ from_component_id: string; to_component_id: string }>;

  const graph = new Map<string, string[]>();
  for (const rel of relationships) {
    if (!graph.has(rel.from_component_id)) graph.set(rel.from_component_id, []);
    graph.get(rel.from_component_id)!.push(rel.to_component_id);
    if (!graph.has(rel.to_component_id)) graph.set(rel.to_component_id, []);
  }
  return graph;
}

function loadAsIsComponentIds(gapIds: string[]): Map<string, string | null> {
  if (gapIds.length === 0) return new Map();
  const placeholders = gapIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT fg.id as gap_id, ap.as_is_component_id
    FROM functional_gaps fg
    JOIN alignment_pairs ap ON fg.alignment_pair_id = ap.id
    WHERE fg.id IN (${placeholders})
  `).all(...gapIds) as Array<{ gap_id: string; as_is_component_id: string | null }>;
  return new Map(rows.map(r => [r.gap_id, r.as_is_component_id]));
}

export function propagateImpacts(runId: string): GapImpact[] {
  const run = db.prepare('SELECT as_is_version_ids FROM functional_analysis_runs WHERE id = ?').get(runId) as { as_is_version_ids: string } | undefined;
  if (!run) return [];

  const asIsVersionIds: string[] = JSON.parse(run.as_is_version_ids);
  const gaps = db.prepare("SELECT * FROM functional_gaps WHERE run_id = ? AND gap_type IN ('modified', 'missing')").all(runId) as FunctionalGap[];
  if (gaps.length === 0) return [];

  const graph = buildGraphForVersions(asIsVersionIds);
  const componentIdByGap = loadAsIsComponentIds(gaps.map(g => g.id));

  const insertStmt = db.prepare(`
    INSERT INTO gap_impacts (id, gap_id, affected_component_id, relationship_path, impact_type)
    VALUES (?, ?, ?, ?, ?)
  `);

  const allImpacts: GapImpact[] = [];

  for (const gap of gaps) {
    const startId = componentIdByGap.get(gap.id) ?? null;
    if (!startId) continue;

    for (const node of bfsTraverse(startId, graph)) {
      const impact: GapImpact = {
        id: uuidv4(),
        gap_id: gap.id,
        affected_component_id: node.id,
        relationship_path: node.path,
        impact_type: 'downstream',
      };
      try {
        insertStmt.run(impact.id, impact.gap_id, impact.affected_component_id, JSON.stringify(impact.relationship_path), impact.impact_type);
        allImpacts.push(impact);
      } catch {
        // Skip duplicates (e.g. re-run scenario)
      }
    }
  }

  return allImpacts;
}
