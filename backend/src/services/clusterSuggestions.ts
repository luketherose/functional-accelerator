/**
 * clusterSuggestions
 *
 * Phase 2 D — Discover hidden clusters in "Other" defects.
 *
 * Takes all unclassified defects (cluster_key = 'other') for a project,
 * sends them to Claude for thematic grouping, and returns actionable
 * suggestions: cluster name, rationale, defect IDs, and keyword additions.
 *
 * Analysts can then "adopt" a suggestion, which appends keywords to the
 * taxonomy and triggers a re-cluster — converting a discovered theme into
 * a permanent, deterministic rule.
 */

import { callClaudeStep } from './claude';

export interface SuggestedCluster {
  /** Short, human-readable theme name (e.g. "Login / SSO Issues") */
  name: string;
  /** 1-2 sentence rationale: why these defects belong together */
  rationale: string;
  /** IDs of defects in this group (use the external_id from ALM) */
  defectIds: string[];
  /** Keywords Claude recommends adding to the taxonomy to capture this theme */
  suggestedKeywords: string[];
}

export interface SuggestClustersResult {
  suggestions: SuggestedCluster[];
  otherCount: number;    // total "other" defects analysed
  coveredCount: number;  // defects covered by at least one suggestion
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildSuggestPrompt(
  defects: { id: string; title: string; description: string }[],
  existingClusterNames: string[]
): string {
  const defectLines = defects.map(d =>
    `[${d.id}] ${d.title}${d.description ? ` — ${d.description.slice(0, 150)}` : ''}`
  ).join('\n');

  const existingList = existingClusterNames.length > 0
    ? `\nExisting taxonomy clusters (already classified, do NOT suggest): ${existingClusterNames.join(', ')}`
    : '';

  return `You are a defect analysis expert. The following defects were NOT matched by any keyword in the existing taxonomy — they all landed in the "Other / Unclassified" bucket.
${existingList}

Your task: identify recurring themes among these unclassified defects and suggest new taxonomy clusters that would capture them.

Rules:
- Group only defects that share a genuine, specific theme (not generic catch-alls like "miscellaneous")
- A group needs at least 2 defects to be worth suggesting
- Suggest the minimum keywords that are precise and distinctive
- If a defect doesn't fit any clear theme, leave it out — don't force clusters
- Return ONLY raw JSON — no prose, no markdown fences

Return this exact schema:
{
  "suggestions": [
    {
      "name": "string — short theme name, e.g. 'Login / SSO Issues'",
      "rationale": "string — 1-2 sentences: why these belong together and what the shared root cause or pattern is",
      "defectIds": ["string — the bracketed ID from the list above"],
      "suggestedKeywords": ["string — lowercase, 1-3 words each, highly specific to this theme"]
    }
  ]
}

Unclassified defects:
${defectLines}`;
}

// ─── Mock fixture ─────────────────────────────────────────────────────────────

function buildMockResult(defects: { id: string; title: string }[]): SuggestClustersResult {
  const half = Math.ceil(defects.length / 2);
  const groupA = defects.slice(0, half);
  const groupB = defects.slice(half);
  const suggestions: SuggestedCluster[] = [];

  if (groupA.length >= 2) {
    suggestions.push({
      name: 'Session / Timeout Issues',
      rationale: '[MOCK] These defects share patterns related to session management and timeout handling across multiple applications.',
      defectIds: groupA.map(d => d.id),
      suggestedKeywords: ['session', 'timeout', 'expiry', 'logout'],
    });
  }
  if (groupB.length >= 2) {
    suggestions.push({
      name: 'File Upload / Export Errors',
      rationale: '[MOCK] These defects describe failures during file upload, export, or download operations.',
      defectIds: groupB.map(d => d.id),
      suggestedKeywords: ['upload', 'export', 'download', 'file', 'attachment'],
    });
  }

  const coveredIds = new Set(suggestions.flatMap(s => s.defectIds));
  return { suggestions, otherCount: defects.length, coveredCount: coveredIds.size };
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function suggestClusters(
  defects: { id: string; title: string; description: string }[],
  existingClusterNames: string[]
): Promise<SuggestClustersResult> {
  if (defects.length === 0) {
    return { suggestions: [], otherCount: 0, coveredCount: 0 };
  }

  if (process.env.CLAUDE_MOCK === 'true') {
    return buildMockResult(defects);
  }

  // Cap to 200 defects to stay within token limits
  const sample = defects.slice(0, 200);
  const prompt = buildSuggestPrompt(sample, existingClusterNames);

  const { suggestions } = await callClaudeStep<{ suggestions: SuggestedCluster[] }>(
    'You are a defect taxonomy expert. Respond with raw JSON only.',
    prompt
  );

  const safe = (Array.isArray(suggestions) ? suggestions : []).filter(
    s => s.name && Array.isArray(s.defectIds) && s.defectIds.length >= 2
  );

  const coveredIds = new Set(safe.flatMap(s => s.defectIds));
  return {
    suggestions: safe,
    otherCount: defects.length,
    coveredCount: coveredIds.size,
  };
}
