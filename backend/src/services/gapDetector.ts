import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import type { AlignmentPair, FunctionalComponent, FunctionalGap, FieldDiff, GapType } from '../types';

const stmtGetComponent = db.prepare('SELECT * FROM functional_components WHERE id = ?');
const stmtGetPairs = db.prepare('SELECT * FROM alignment_pairs WHERE run_id = ?');
const stmtInsertGap = db.prepare(`
  INSERT INTO functional_gaps
    (id, run_id, alignment_pair_id, gap_type, status, field_diffs, as_is_quote, to_be_quote, as_is_section, to_be_section, explanation, confidence, verification_reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function normalize(text: string | null | undefined): string {
  if (!text) return '';
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function loadComponent(id: string | null): FunctionalComponent | null {
  if (!id) return null;
  return stmtGetComponent.get(id) as FunctionalComponent | null;
}

function insertGap(gap: FunctionalGap): void {
  stmtInsertGap.run(
    gap.id, gap.run_id, gap.alignment_pair_id, gap.gap_type, gap.status,
    JSON.stringify(gap.field_diffs),
    gap.as_is_quote, gap.to_be_quote, gap.as_is_section, gap.to_be_section,
    gap.explanation, gap.confidence, gap.verification_reason
  );
}

function diffComponents(asIs: FunctionalComponent, toBe: FunctionalComponent): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const fields: Array<keyof FunctionalComponent> = ['description', 'condition_text', 'action_text', 'type'];
  for (const field of fields) {
    const a = normalize(asIs[field] as string);
    const b = normalize(toBe[field] as string);
    if (a !== b && (a || b)) {
      diffs.push({ field, as_is_value: (asIs[field] as string) ?? '', to_be_value: (toBe[field] as string) ?? '' });
    }
  }
  return diffs;
}

export function detectGaps(runId: string): FunctionalGap[] {
  const pairs = stmtGetPairs.all(runId) as AlignmentPair[];
  const gaps: FunctionalGap[] = [];
  const now = new Date().toISOString();

  for (const pair of pairs) {
    let gapType: GapType;
    let fieldDiffs: FieldDiff[] = [];
    let asIsQuote: string | null = null;
    let toBeQuote: string | null = null;
    let asIsSection: string | null = null;
    let toBeSection: string | null = null;
    let explanation: string | null = null;
    let confidence: number | null = pair.confidence;

    if (pair.match_type === 'unmatched_asis') {
      gapType = 'missing';
      const asIs = loadComponent(pair.as_is_component_id);
      asIsQuote = asIs?.source_quote ?? null;
      asIsSection = asIs?.source_section ?? null;
      explanation = `This AS-IS component has no corresponding entry in the TO-BE specification.`;
      confidence = 1.0;
    } else if (pair.match_type === 'unmatched_tobe') {
      gapType = 'new';
      const toBe = loadComponent(pair.to_be_component_id);
      toBeQuote = toBe?.source_quote ?? null;
      toBeSection = toBe?.source_section ?? null;
      explanation = `This is a new component introduced in the TO-BE specification with no AS-IS counterpart.`;
      confidence = 1.0;
    } else if (pair.match_type === 'confirmed') {
      const asIs = loadComponent(pair.as_is_component_id);
      const toBe = loadComponent(pair.to_be_component_id);
      if (!asIs || !toBe) continue;

      asIsQuote = asIs.source_quote;
      toBeQuote = toBe.source_quote;
      asIsSection = asIs.source_section;
      toBeSection = toBe.source_section;

      fieldDiffs = diffComponents(asIs, toBe);
      if (fieldDiffs.length > 0) {
        gapType = 'modified';
        explanation = `The component exists in both specifications but differs in: ${fieldDiffs.map(d => d.field).join(', ')}.`;
      } else {
        gapType = 'unchanged';
        explanation = null;
      }
    } else {
      gapType = 'missing';
      const asIs = loadComponent(pair.as_is_component_id);
      asIsQuote = asIs?.source_quote ?? null;
      asIsSection = asIs?.source_section ?? null;
      explanation = `Alignment was rejected: ${pair.match_reason ?? 'no matching TO-BE component found.'}`;
      confidence = 0.5;
    }

    const gap: FunctionalGap = {
      id: uuidv4(),
      run_id: runId,
      alignment_pair_id: pair.id,
      gap_type: gapType,
      status: 'pending',
      field_diffs: fieldDiffs,
      as_is_quote: asIsQuote,
      to_be_quote: toBeQuote,
      as_is_section: asIsSection,
      to_be_section: toBeSection,
      explanation,
      confidence,
      verification_reason: null,
      created_at: now,
    };

    insertGap(gap);
    gaps.push(gap);
  }

  return gaps;
}
