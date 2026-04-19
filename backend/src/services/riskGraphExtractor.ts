/**
 * Risk Graph Extractor — extracts entities and relations for the
 * RISK domain from defect and document data.
 *
 * Ontology: Risk, Control, Requirement, Regulation, Evidence, Mitigation,
 *   Process, Asset, Data Class, Finding, Issue, Document + auto-discovered.
 *
 * Relations: CONTROL_MITIGATES_RISK, REQUIREMENT_REQUIRES_CONTROL,
 *   EVIDENCE_SUPPORTS_CONTROL, ISSUE_WEAKENS_CONTROL, PROCESS_EXPOSES_RISK,
 *   APPLIES_TO, DOCUMENTS, IDENTIFIED_IN, etc.
 *
 * Behavior depends on domain mode (manual / assisted / auto).
 */

import { callClaudeStep } from './claude';
import { getDomainSettings, createSuggestion, upsertDomainEntity, upsertDomainRelation, checkGovernanceMemory } from './graphDomainService';

interface DefectSample {
  title: string;
  priority: string;
}

interface ExtractedEntity {
  entity_type: string;
  name: string;
  description?: string;
  source_quote?: string;
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

const SYSTEM_PROMPT = `You are a precise information extraction engine for enterprise risk and defect analysis documents.

Extract entities and relationships that represent the RISK landscape of the described system.

Entity types to recognize:
- risk: An identified risk or threat ("Data Breach Risk", "Compliance Failure Risk")
- control: A control measure or safeguard ("Access Control Policy", "Encryption Control")
- requirement: A compliance or functional requirement ("GDPR Article 32", "SOX Requirement")
- regulation: A regulation, law, or standard ("GDPR", "SOX", "ISO 27001")
- evidence: An evidence artifact supporting a control ("Audit Log", "Test Report")
- mitigation: A mitigation or remediation action ("Patch Application", "User Training")
- process: A business process relevant to risk ("Payment Processing", "User Onboarding")
- asset: A business or technical asset at risk ("Customer Database", "Payment System")
- data_class: A class of sensitive data ("PII", "Financial Data", "Health Records")
- finding: An audit finding or identified issue ("Missing Encryption Finding")
- issue: A known issue, defect, or vulnerability ("SQL Injection Vulnerability")
- document: A policy, procedure, or evidence document ("Security Policy", "Audit Report")

Relation types:
- mitigates: control mitigates risk
- requires_control: requirement requires a control
- supports_control: evidence supports a control
- weakens_control: issue weakens a control
- exposes_risk: process exposes a risk
- applies_to: regulation applies to process or asset
- documents: document documents a finding or control
- identified_in: finding identified in process or asset
- classifies: data class classifies an asset
- remediates: mitigation remediates a finding or risk

Rules:
- Extract only entities explicitly named or clearly identifiable in the text
- Confidence 0.6–1.0 reflects clarity of the entity
- Return raw JSON only — no markdown fences

JSON schema:
{
  "entities": [{"entity_type": "...", "name": "...", "description": "...", "source_quote": "...", "confidence": 0.85}],
  "relations": [{"source_name": "...", "target_name": "...", "relation_type": "...", "confidence": 0.8, "source_quote": "..."}]
}`;

/**
 * Extract risk entities from a cluster summary + defect titles for a UAT analysis run.
 * Called at the end of the UAT pipeline when mode is not 'manual'.
 */
export async function runRiskGraphExtractionFromDefects(
  projectId: string,
  uatAnalysisId: string,
  clusters: { cluster_name: string; summary: string; defects: DefectSample[] }[]
): Promise<{ entitiesFound: number; relationsFound: number }> {
  if (process.env.CLAUDE_MOCK === 'true') return { entitiesFound: 0, relationsFound: 0 };

  const settings = getDomainSettings(projectId, 'risk');
  if (settings.mode === 'manual') return { entitiesFound: 0, relationsFound: 0 };

  const contextText = clusters
    .map(c => {
      const topDefects = c.defects.slice(0, 8).map(d => `  - [${d.priority}] ${d.title}`).join('\n');
      return `## Cluster: ${c.cluster_name}\n${c.summary}\n\nTop defects:\n${topDefects}`;
    })
    .join('\n\n---\n\n');

  if (!contextText.trim()) return { entitiesFound: 0, relationsFound: 0 };

  const sourceDocs = [`UAT Analysis ${uatAnalysisId}`];
  const nameToId = new Map<string, string>();

  try {
    const result = await callClaudeStep<ExtractionResponse>(
      SYSTEM_PROMPT,
      `Extract all risk entities and relationships from the following defect cluster analysis.\n\n${contextText}\n\nReturn raw JSON only.`,
      0.0,
      4096
    );

    const entities: ExtractedEntity[] = result.entities ?? [];
    const relations: ExtractedRelation[] = result.relations ?? [];
    const filtered = applyGovernanceFilter(projectId, entities);

    if (settings.mode === 'assisted') {
      for (const e of filtered) {
        createSuggestion(projectId, 'risk', {
          entity_type: e.entity_type,
          name: e.name,
          description: e.description,
          source_quote: e.source_quote,
          confidence: e.confidence ?? 0.8,
          source_docs: sourceDocs,
          why_suggested: `Auto-discovered from defect cluster analysis (risk domain)`,
        });
      }
    } else {
      for (const e of filtered) {
        const id = upsertDomainEntity(projectId, 'risk', {
          entity_type: e.entity_type,
          name: e.name,
          description: e.description,
          source_quote: e.source_quote,
          confidence: e.confidence ?? 0.8,
          source_docs: sourceDocs,
        });
        if (id) nameToId.set(e.name.toLowerCase(), id);
      }

      for (const r of relations) {
        const srcId = nameToId.get(r.source_name.toLowerCase());
        const tgtId = nameToId.get(r.target_name.toLowerCase());
        if (srcId && tgtId) {
          upsertDomainRelation(projectId, 'risk', srcId, tgtId, r.relation_type, r.confidence ?? 0.7, r.source_quote);
        }
      }
    }

    return { entitiesFound: filtered.length, relationsFound: relations.length };
  } catch (err) {
    console.warn('[riskGraphExtractor] Extraction failed:', err);
    return { entitiesFound: 0, relationsFound: 0 };
  }
}

function applyGovernanceFilter(projectId: string, entities: ExtractedEntity[]): ExtractedEntity[] {
  return entities.filter(e => {
    const mem = checkGovernanceMemory(projectId, 'risk', e.name);
    return !mem.suppress;
  });
}
