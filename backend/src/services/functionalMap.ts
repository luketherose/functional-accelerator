import db from '../db';
import type { FunctionalComponent, ComponentRelationship } from '../types';

export interface ComponentNode {
  id: string;
  path: string[];
}

const stmtRelationships = db.prepare(`
  SELECT cr.* FROM component_relationships cr
  JOIN functional_components fc ON cr.from_component_id = fc.id
  WHERE fc.document_version_id = ?
`);

export function buildComponentGraph(versionId: string): Map<string, string[]> {
  const relationships = stmtRelationships.all(versionId) as ComponentRelationship[];
  const graph = new Map<string, string[]>();

  for (const rel of relationships) {
    if (!graph.has(rel.from_component_id)) graph.set(rel.from_component_id, []);
    graph.get(rel.from_component_id)!.push(rel.to_component_id);
    if (!graph.has(rel.to_component_id)) graph.set(rel.to_component_id, []);
  }

  return graph;
}

export function bfsTraverse(startComponentId: string, graph: Map<string, string[]>): ComponentNode[] {
  const visited = new Set<string>();
  const queue: ComponentNode[] = [{ id: startComponentId, path: [startComponentId] }];
  const result: ComponentNode[] = [];

  visited.add(startComponentId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighborId of (graph.get(current.id) ?? [])) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        const node: ComponentNode = { id: neighborId, path: [...current.path, neighborId] };
        result.push(node);
        queue.push(node);
      }
    }
  }

  return result;
}

export function getDownstreamComponents(
  componentId: string,
  versionId: string
): Array<{ component: FunctionalComponent; path: string[] }> {
  const graph = buildComponentGraph(versionId);
  const nodes = bfsTraverse(componentId, graph);
  if (nodes.length === 0) return [];

  const ids = nodes.map(n => n.id);
  const placeholders = ids.map(() => '?').join(',');
  const components = db.prepare(
    `SELECT * FROM functional_components WHERE id IN (${placeholders})`
  ).all(...ids) as FunctionalComponent[];

  const byId = new Map(components.map(c => [c.id, c]));
  return nodes.flatMap(node => {
    const component = byId.get(node.id);
    return component ? [{ component, path: node.path }] : [];
  });
}
