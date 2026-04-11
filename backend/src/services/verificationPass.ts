import db from '../db';
import { callClaudeStep } from './claude';
import type { FunctionalGap, GapStatus } from '../types';

const MOCK = process.env.CLAUDE_MOCK === 'true';
const BATCH_SIZE = 20;

interface GapReview {
  gap_index: number;
  verdict: 'confirmed' | 'rejected';
  reason: string;
}

function buildVerificationPrompt(gapsJson: string): string {
  return `You are a quality reviewer for a functional gap analysis. Review each gap and determine if it is genuinely supported by the quoted evidence.

For each gap:
- If the as_is_quote and to_be_quote clearly demonstrate the stated gap_type and explanation: verdict = "confirmed"
- If the gap is NOT supported by the quotes, quotes are missing, or the explanation is speculative: verdict = "rejected"
- Apply a strict standard. When in doubt, reject.
- "unchanged" gaps should always be confirmed if they have matching evidence.

OUTPUT SCHEMA:
{
  "reviews": [
    { "gap_index": 0, "verdict": "confirmed|rejected", "reason": "one sentence" }
  ]
}

Return raw JSON only. No prose.

GAPS TO REVIEW:
${gapsJson}`;
}

export async function runVerificationPass(runId: string): Promise<void> {
  const gaps = db.prepare("SELECT * FROM functional_gaps WHERE run_id = ? AND status = 'pending'").all(runId) as FunctionalGap[];

  if (MOCK) {
    db.prepare("UPDATE functional_gaps SET status = 'confirmed', verification_reason = 'Mock verification' WHERE run_id = ? AND status = 'pending'").run(runId);
    return;
  }

  const updateStmt = db.prepare("UPDATE functional_gaps SET status = ?, verification_reason = ? WHERE id = ?");

  for (let i = 0; i < gaps.length; i += BATCH_SIZE) {
    const batch = gaps.slice(i, i + BATCH_SIZE);
    const batchForPrompt = batch.map((g, idx) => ({
      gap_index: idx,
      gap_type: g.gap_type,
      explanation: g.explanation,
      as_is_quote: g.as_is_quote,
      to_be_quote: g.to_be_quote,
      field_diffs: g.field_diffs,
    }));

    let reviews: GapReview[] = [];
    try {
      const result = await callClaudeStep<{ reviews: GapReview[] }>(
        'You are a strict quality reviewer. Return only the JSON object specified.',
        buildVerificationPrompt(JSON.stringify(batchForPrompt, null, 2)),
        0,
        2000
      );
      reviews = result?.reviews ?? [];
    } catch {
      // Fail-open: confirm all in batch when verification is unavailable
      reviews = batch.map((_, idx) => ({ gap_index: idx, verdict: 'confirmed' as const, reason: 'Verification unavailable' }));
    }

    for (const review of reviews) {
      const gap = batch[review.gap_index];
      if (!gap) continue;
      const status: GapStatus = review.verdict === 'confirmed' ? 'confirmed' : 'rejected';
      updateStmt.run(status, review.reason, gap.id);
    }
  }
}
