import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { callClaudeStep } from './claude';
import { semanticChunk } from './chunking';
import { embedText, serializeEmbedding } from './embeddings';
import { buildFunctionalExtractionSystemPrompt, buildFunctionalExtractionUserPrompt, buildRelationshipExtractionPrompt } from './promptBuilder';
import type { FunctionalComponent, FunctionalComponentType, ComponentRelationship, RelationshipType, FileBucket } from '../types';

const MOCK = process.env.CLAUDE_MOCK === 'true';

const VALID_COMPONENT_TYPES: FunctionalComponentType[] = ['process', 'business_rule', 'input', 'output', 'validation', 'integration', 'ui_element'];
const VALID_RELATIONSHIP_TYPES: RelationshipType[] = ['triggers', 'produces', 'validates', 'calls', 'depends_on'];

interface RawComponent {
  type: string;
  title: string;
  description: string;
  condition?: string;
  action?: string;
  source_section: string;
  source_quote: string;
  confidence: number;
}

interface RawRelationship {
  from_component_title: string;
  to_component_title: string;
  relationship_type: string;
  source_quote: string;
}

function mockComponents(versionId: string): FunctionalComponent[] {
  const now = new Date().toISOString();
  return [
    {
      id: uuidv4(),
      document_version_id: versionId,
      type: 'process',
      title: 'Mock Process A',
      description: 'A mock process for testing',
      condition_text: null,
      action_text: null,
      source_section: '1. Introduction',
      source_quote: 'The system processes user requests.',
      confidence: 0.95,
      created_at: now,
    },
    {
      id: uuidv4(),
      document_version_id: versionId,
      type: 'business_rule',
      title: 'Mock Rule BR-01',
      description: 'A mock business rule',
      condition_text: 'If user is logged in',
      action_text: 'Grant access',
      source_section: '2. Rules',
      source_quote: 'If user is logged in, grant access.',
      confidence: 0.90,
      created_at: now,
    },
  ];
}

export async function extractFunctionalComponents(
  versionId: string,
  text: string,
  docName: string,
  docType: FileBucket
): Promise<FunctionalComponent[]> {
  if (MOCK) {
    const components = mockComponents(versionId);
    const stmt = db.prepare(
      `INSERT INTO functional_components (id, document_version_id, type, title, description, condition_text, action_text, source_section, source_quote, confidence, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    );
    for (const c of components) {
      stmt.run(c.id, c.document_version_id, c.type, c.title, c.description, c.condition_text, c.action_text, c.source_section, c.source_quote, c.confidence);
    }
    return components;
  }

  const chunks = semanticChunk(text, docName, docType);
  const allComponents: FunctionalComponent[] = [];

  const insertStmt = db.prepare(
    `INSERT INTO functional_components (id, document_version_id, type, title, description, condition_text, action_text, source_section, source_quote, confidence, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const chunk of chunks) {
    if (chunk.content.trim().length < 50) continue;

    let result: { components: RawComponent[] };
    try {
      result = await callClaudeStep<{ components: RawComponent[] }>(
        buildFunctionalExtractionSystemPrompt(),
        buildFunctionalExtractionUserPrompt(chunk.sectionPath, chunk.content),
        0,
        2000
      );
    } catch {
      continue;
    }

    if (!result?.components || !Array.isArray(result.components)) continue;

    for (const raw of result.components) {
      if (!raw.source_quote || raw.source_quote.trim().length < 10) continue;
      if ((raw.confidence ?? 0) < 0.7) continue;
      if (!raw.title || !raw.description || !raw.type) continue;
      if (!VALID_COMPONENT_TYPES.includes(raw.type as FunctionalComponentType)) continue;

      let embeddingBlob: Buffer | null = null;
      try {
        const vec = await embedText(`${raw.title} ${raw.description}`);
        embeddingBlob = serializeEmbedding(vec.embedding) as Buffer;
      } catch {
        embeddingBlob = null;
      }

      const component: FunctionalComponent = {
        id: uuidv4(),
        document_version_id: versionId,
        type: raw.type as FunctionalComponent['type'],
        title: raw.title.trim(),
        description: raw.description.trim(),
        condition_text: raw.condition?.trim() ?? null,
        action_text: raw.action?.trim() ?? null,
        source_section: raw.source_section?.trim() || chunk.sectionPath,
        source_quote: raw.source_quote.trim(),
        confidence: raw.confidence,
        created_at: new Date().toISOString(),
      };

      insertStmt.run(
        component.id,
        component.document_version_id,
        component.type,
        component.title,
        component.description,
        component.condition_text,
        component.action_text,
        component.source_section,
        component.source_quote,
        component.confidence,
        embeddingBlob
      );
      allComponents.push(component);
    }
  }

  return allComponents;
}

export async function extractComponentRelationships(
  components: FunctionalComponent[],
  fullText: string
): Promise<ComponentRelationship[]> {
  if (MOCK || components.length === 0) return [];

  const titleToId = new Map(components.map(c => [c.title, c.id]));

  let result: { relationships: RawRelationship[] };
  try {
    result = await callClaudeStep<{ relationships: RawRelationship[] }>(
      'You extract relationships between functional components. Return raw JSON only.',
      buildRelationshipExtractionPrompt(
        JSON.stringify(components.map(c => ({ title: c.title, type: c.type, description: c.description })), null, 2),
        fullText.slice(0, 8000)
      ),
      0,
      2000
    );
  } catch {
    return [];
  }

  if (!result?.relationships || !Array.isArray(result.relationships)) return [];

  const now = new Date().toISOString();
  const insertStmt = db.prepare(
    `INSERT INTO component_relationships (id, from_component_id, to_component_id, relationship_type, source_quote)
     VALUES (?, ?, ?, ?, ?)`
  );
  const saved: ComponentRelationship[] = [];

  for (const raw of result.relationships) {
    const fromId = titleToId.get(raw.from_component_title);
    const toId = titleToId.get(raw.to_component_title);
    if (!fromId || !toId || fromId === toId) continue;
    if (!VALID_RELATIONSHIP_TYPES.includes(raw.relationship_type as RelationshipType)) continue;
    if (!raw.source_quote || raw.source_quote.trim().length < 10) continue;

    const rel: ComponentRelationship = {
      id: uuidv4(),
      from_component_id: fromId,
      to_component_id: toId,
      relationship_type: raw.relationship_type as ComponentRelationship['relationship_type'],
      source_quote: raw.source_quote.trim(),
      created_at: now,
    };
    try {
      insertStmt.run(rel.id, rel.from_component_id, rel.to_component_id, rel.relationship_type, rel.source_quote);
      saved.push(rel);
    } catch {
      // Skip duplicate relationships
    }
  }

  return saved;
}
