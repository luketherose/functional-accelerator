/**
 * UAT Risk Analysis Pipeline
 *
 * Takes a parsed list of ALM defects and calls Claude to produce a
 * structured UATAnalysisResult dashboard.
 *
 * Two-step approach:
 *   Step 1 — Compute statistics locally (no Claude needed — fast and free)
 *   Step 2 — Claude qualitative analysis: patterns, risk areas, prevention actions
 *
 * This keeps costs low: we only send Claude a summary + the top defects,
 * not the entire raw defect list.
 */

import type { Defect } from './almParser';
import { defectsToPromptText } from './almParser';
import { callClaudeStep } from './claude';
import type { UATAnalysisResult, UATApplicationStat } from '../types';

export interface UATProgressCallback {
  (step: string): void;
}

// ─── Step 1: Local statistics ─────────────────────────────────────────────────

function computeStats(defects: Defect[]) {
  const priorityOrder = ['Critical', 'High', 'Medium', 'Low', 'Unknown'];

  // By application
  const appMap = new Map<string, UATApplicationStat>();
  for (const d of defects) {
    const app = d.application || 'Unknown';
    if (!appMap.has(app)) {
      appMap.set(app, { application: app, total: 0, critical: 0, high: 0, medium: 0, low: 0, riskScore: 0 });
    }
    const stat = appMap.get(app)!;
    stat.total++;
    if (d.priority === 'Critical') stat.critical++;
    else if (d.priority === 'High') stat.high++;
    else if (d.priority === 'Medium') stat.medium++;
    else stat.low++;
    stat.riskScore = stat.critical * 4 + stat.high * 2 + stat.medium * 1;
  }
  const byApplication = [...appMap.values()].sort((a, b) => b.riskScore - a.riskScore);

  // By priority
  const priorityMap = new Map<string, number>();
  for (const d of defects) priorityMap.set(d.priority, (priorityMap.get(d.priority) || 0) + 1);
  const byPriority = priorityOrder
    .filter(p => priorityMap.has(p))
    .map(p => ({
      priority: p,
      count: priorityMap.get(p)!,
      percentage: Math.round((priorityMap.get(p)! / defects.length) * 100),
    }));

  // By module
  const moduleMap = new Map<string, { count: number; criticalCount: number }>();
  for (const d of defects) {
    const mod = d.module || 'Other';
    if (!moduleMap.has(mod)) moduleMap.set(mod, { count: 0, criticalCount: 0 });
    const m = moduleMap.get(mod)!;
    m.count++;
    if (d.priority === 'Critical' || d.priority === 'High') m.criticalCount++;
  }
  const byModule = [...moduleMap.entries()]
    .map(([module, v]) => ({ module, ...v }))
    .sort((a, b) => b.criticalCount - a.criticalCount || b.count - a.count)
    .slice(0, 15);

  // Top defects (Critical + High, sorted)
  const topDefects = defects
    .filter(d => d.priority === 'Critical' || d.priority === 'High')
    .sort((a, b) => {
      const po = ['Critical', 'High'];
      return po.indexOf(a.priority) - po.indexOf(b.priority);
    })
    .slice(0, 20)
    .map(d => ({
      id: d.id,
      title: d.title,
      priority: d.priority,
      application: d.application,
      module: d.module || 'N/A',
      impact: d.description.slice(0, 200),
    }));

  // Overall risk level based on critical/high ratio
  const criticalHighCount = defects.filter(d => d.priority === 'Critical' || d.priority === 'High').length;
  const criticalHighRatio = criticalHighCount / Math.max(defects.length, 1);
  const overallRiskLevel: 'high' | 'medium' | 'low' = criticalHighRatio > 0.4 ? 'high' : criticalHighRatio > 0.2 ? 'medium' : 'low';

  return { byApplication, byPriority, byModule, topDefects, overallRiskLevel };
}

// ─── Step 2: Claude qualitative analysis ─────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior QA / delivery risk analyst. You receive a structured summary of defects found during UAT (User Acceptance Testing) of a software project.

Your task is to produce a JSON analysis with:
1. An executive summary (2-3 paragraphs) of the UAT quality and risk posture
2. Recurring defect patterns with occurrence counts
3. Risk areas with evidence-based rationale and concrete recommendations
4. Prevention actions prioritized by impact, with effort estimates
5. A qualityTrend narrative about open/closed rates and resolution patterns

Rules:
- Return ONLY valid raw JSON, no markdown fences, no prose outside the JSON
- Be specific: name the applications (AOO, KFC, Oracle, ESI, etc.) where relevant
- Prevention actions must be concrete and actionable, not generic advice
- Risk areas must cite specific patterns from the data

Output schema:
{
  "executiveSummary": "string",
  "qualityTrend": "string",
  "recurringPatterns": [
    { "pattern": "string", "occurrences": number, "applications": ["string"], "priority": "high|medium|low" }
  ],
  "riskAreas": [
    { "area": "string", "riskLevel": "high|medium|low", "rationale": "string", "recommendation": "string", "relatedApplications": ["string"] }
  ],
  "preventionActions": [
    { "action": "string", "priority": "high|medium|low", "targetApplication": "string", "effort": "low|medium|high" }
  ]
}`;

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runUATPipeline(
  defects: Defect[],
  projectName: string,
  onProgress?: UATProgressCallback
): Promise<UATAnalysisResult> {
  if (process.env.CLAUDE_MOCK === 'true') {
    onProgress?.('Mock mode — returning fixture data');
    return mockUATResult(defects);
  }

  // Step 1: local stats (instant)
  onProgress?.('Step 1/2 — Computing defect statistics…');
  const stats = computeStats(defects);

  // Step 2: Claude qualitative analysis
  onProgress?.('Step 2/2 — Analysing patterns and generating risk insights…');

  const statsSummary = `
Project: ${projectName}
Total defects: ${defects.length}

Priority breakdown:
${stats.byPriority.map(p => `  ${p.priority}: ${p.count} (${p.percentage}%)`).join('\n')}

By application (top 10 by risk score):
${stats.byApplication.slice(0, 10).map(a =>
  `  ${a.application}: ${a.total} total (Critical: ${a.critical}, High: ${a.high}, Medium: ${a.medium}, Low: ${a.low}) — RiskScore: ${a.riskScore}`
).join('\n')}

By functional module (top 10):
${stats.byModule.slice(0, 10).map(m =>
  `  ${m.module}: ${m.count} defects (${m.criticalCount} critical/high)`
).join('\n')}

Sample defect detail (Critical + High priority):
${defectsToPromptText(defects.filter(d => d.priority === 'Critical' || d.priority === 'High'), 80)}
`.trim();

  const claudeResult = await callClaudeStep<Pick<UATAnalysisResult, 'executiveSummary' | 'qualityTrend' | 'recurringPatterns' | 'riskAreas' | 'preventionActions'>>(
    SYSTEM_PROMPT,
    `Analyse this UAT defect data and return the JSON analysis:\n\n${statsSummary}`,
    0.2,
    8192
  );

  return {
    executiveSummary: claudeResult.executiveSummary || 'No summary produced.',
    overallRiskLevel: stats.overallRiskLevel,
    totalDefects: defects.length,
    byApplication: stats.byApplication,
    byPriority: stats.byPriority,
    byModule: stats.byModule,
    topDefects: stats.topDefects,
    recurringPatterns: Array.isArray(claudeResult.recurringPatterns) ? claudeResult.recurringPatterns : [],
    riskAreas: Array.isArray(claudeResult.riskAreas) ? claudeResult.riskAreas : [],
    preventionActions: Array.isArray(claudeResult.preventionActions) ? claudeResult.preventionActions : [],
    qualityTrend: claudeResult.qualityTrend || '',
  };
}

// ─── Mock fixture ─────────────────────────────────────────────────────────────

function mockUATResult(defects: Defect[]): UATAnalysisResult {
  const stats = computeStats(defects.length > 0 ? defects : MOCK_DEFECTS);
  return {
    executiveSummary: '[MOCK] UAT Risk Analysis — set CLAUDE_MOCK=false for real results. The project shows moderate risk concentration in the KFC and Oracle integration layers, with a pattern of data validation defects that persisted across multiple test cycles.',
    overallRiskLevel: 'medium',
    totalDefects: defects.length || MOCK_DEFECTS.length,
    byApplication: stats.byApplication,
    byPriority: stats.byPriority,
    byModule: stats.byModule,
    topDefects: stats.topDefects,
    recurringPatterns: [
      { pattern: 'Incorrect calculation of interest rates', occurrences: 7, applications: ['KFC', 'Oracle'], priority: 'high' },
      { pattern: 'Session timeout not handled gracefully', occurrences: 5, applications: ['AOO'], priority: 'medium' },
      { pattern: 'Missing mandatory field validation', occurrences: 8, applications: ['ESI', 'KFC'], priority: 'medium' },
    ],
    riskAreas: [
      { area: 'KFC–Oracle integration', riskLevel: 'high', rationale: '12 critical defects related to data sync between KFC and Oracle GL', recommendation: 'Add integration test suite with contract testing before each UAT cycle', relatedApplications: ['KFC', 'Oracle'] },
      { area: 'AOO session management', riskLevel: 'medium', rationale: 'Repeated session timeout defects affecting user workflows', recommendation: 'Implement server-side session monitoring and graceful re-auth flow', relatedApplications: ['AOO'] },
    ],
    preventionActions: [
      { action: 'Implement automated regression suite for KFC–Oracle data exchange', priority: 'high', targetApplication: 'KFC', effort: 'high' },
      { action: 'Add field-level validation unit tests for ESI forms', priority: 'medium', targetApplication: 'ESI', effort: 'low' },
      { action: 'Create UAT smoke test checklist for session handling', priority: 'medium', targetApplication: 'AOO', effort: 'low' },
    ],
    qualityTrend: '[MOCK] 68% of defects were closed within the sprint. Critical defects showed a 3-day average resolution time. Recurring patterns suggest insufficient unit testing coverage at integration boundaries.',
  };
}

// Minimal mock defects for when no file is provided in mock mode
const MOCK_DEFECTS: Defect[] = [
  { id: '1', title: 'Interest calc wrong', priority: 'Critical', severity: 'Critical', status: 'Closed', application: 'KFC', module: 'Calculations', description: '', resolution: '', detectedBy: '', assignedTo: '', detectedDate: '', closedDate: '', environment: '', rawRow: {} },
  { id: '2', title: 'Oracle sync fails', priority: 'High', severity: 'High', status: 'Open', application: 'Oracle', module: 'Integration', description: '', resolution: '', detectedBy: '', assignedTo: '', detectedDate: '', closedDate: '', environment: '', rawRow: {} },
  { id: '3', title: 'Session timeout', priority: 'Medium', severity: 'Medium', status: 'Closed', application: 'AOO', module: 'Auth', description: '', resolution: '', detectedBy: '', assignedTo: '', detectedDate: '', closedDate: '', environment: '', rawRow: {} },
];
