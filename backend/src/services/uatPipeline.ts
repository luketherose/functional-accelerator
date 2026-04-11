/**
 * UAT Risk Analysis Pipeline
 *
 * Phase 1 upgrade:
 *   Step 1 — Compute statistics locally (no Claude, instant)
 *   Step 2 — Classify defects with keyword taxonomy (deterministic, no Claude)
 *   Step 3 — Per-cluster Claude summaries (one call for all clusters)
 *   Step 4 — Executive summary with run-over-run delta (one Claude call)
 *
 * Returns both the full UATAnalysisResult and the raw classification data
 * so the caller (route) can persist assignments to DB.
 */

import type { Defect } from './almParser';
import { defectsToPromptText } from './almParser';
import { classifyDefects } from './taxonomy';
import { callClaudeStep } from './claude';
import type { UATAnalysisResult, UATApplicationStat, ClusterSummary } from '../types';

export interface UATProgressCallback {
  (step: string): void;
}

export interface DefectClassification {
  defectExternalId: string;
  clusterKey: string;
  clusterName: string;
  method: 'rule' | 'unclassified';
  matchedKeywords: string[];
}

export interface UATRunContext {
  /** Previous run's result_json for delta comparison (optional) */
  previousResultJson?: string | null;
  projectName: string;
}

export interface PipelineResult {
  result: UATAnalysisResult;
  classifications: DefectClassification[];
}

// ─── Step 1: Local statistics ─────────────────────────────────────────────────

function computeStats(defects: Defect[]) {
  const priorityOrder = ['Critical', 'High', 'Medium', 'Low', 'Unknown'];

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

  const priorityMap = new Map<string, number>();
  for (const d of defects) priorityMap.set(d.priority, (priorityMap.get(d.priority) || 0) + 1);
  const byPriority = priorityOrder
    .filter(p => priorityMap.has(p))
    .map(p => ({
      priority: p,
      count: priorityMap.get(p)!,
      percentage: Math.round((priorityMap.get(p)! / defects.length) * 100),
    }));

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

  const topDefects = defects
    .filter(d => d.priority === 'Critical' || d.priority === 'High')
    .sort((a, b) => (['Critical', 'High'].indexOf(a.priority) - ['Critical', 'High'].indexOf(b.priority)))
    .slice(0, 20)
    .map(d => ({
      id: d.id,
      title: d.title,
      priority: d.priority,
      application: d.application,
      module: d.module || 'N/A',
      impact: d.description.slice(0, 200),
    }));

  const criticalHighCount = defects.filter(d => d.priority === 'Critical' || d.priority === 'High').length;
  const ratio = criticalHighCount / Math.max(defects.length, 1);
  const overallRiskLevel: 'high' | 'medium' | 'low' = ratio > 0.4 ? 'high' : ratio > 0.2 ? 'medium' : 'low';

  return { byApplication, byPriority, byModule, topDefects, overallRiskLevel };
}

// ─── Step 2: Taxonomy classification → cluster stats ─────────────────────────

function buildClusterStats(
  defects: Defect[],
  classifications: DefectClassification[]
): Map<string, { name: string; defects: Defect[] }> {
  const clusterMap = new Map<string, { name: string; defects: Defect[] }>();

  for (let i = 0; i < defects.length; i++) {
    const cls = classifications[i];
    if (!clusterMap.has(cls.clusterKey)) {
      clusterMap.set(cls.clusterKey, { name: cls.clusterName, defects: [] });
    }
    clusterMap.get(cls.clusterKey)!.defects.push(defects[i]);
  }

  return clusterMap;
}

// ─── Step 3: Per-cluster Claude summaries (one batched call) ─────────────────

const CLUSTER_SUMMARY_SYSTEM = `You are a QA risk analyst summarizing defect clusters for an enterprise risk report.

For each cluster, write:
- claudeSummary: 2 sentences describing the defect pattern and what it means for the project
- businessImpact: 1 sentence on the concrete business risk if not addressed
- recommendation: 1 sentence on the most important mitigation action

Rules:
- Be specific: name the applications involved
- Focus on actionable insights, not generic QA advice
- Return ONLY raw JSON — no markdown fences, no prose outside the JSON
- Return a JSON array with one object per cluster

Output schema:
[{ "clusterKey": "string", "claudeSummary": "string", "businessImpact": "string", "recommendation": "string" }]`;

interface ClusterPromptEntry {
  clusterKey: string;
  clusterName: string;
  defectCount: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  applications: string[];
  sampleDefects: { title: string; priority: string; application: string }[];
}

async function generateClusterSummaries(
  clusterMap: Map<string, { name: string; defects: Defect[] }>,
  projectName: string
): Promise<Record<string, { claudeSummary: string; businessImpact: string; recommendation: string }>> {
  // Build compact cluster entries for the prompt
  const entries: ClusterPromptEntry[] = [];
  for (const [key, { name, defects }] of clusterMap.entries()) {
    if (defects.length === 0 || key === 'other') continue;

    const appCount = new Map<string, number>();
    let critical = 0, high = 0, medium = 0, low = 0;
    for (const d of defects) {
      appCount.set(d.application, (appCount.get(d.application) || 0) + 1);
      if (d.priority === 'Critical') critical++;
      else if (d.priority === 'High') high++;
      else if (d.priority === 'Medium') medium++;
      else low++;
    }
    const topApps = [...appCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
    const sample = defects
      .filter(d => d.priority === 'Critical' || d.priority === 'High')
      .slice(0, 5)
      .map(d => ({ title: d.title, priority: d.priority, application: d.application }));

    entries.push({ clusterKey: key, clusterName: name, defectCount: defects.length, critical, high, medium, low, applications: topApps, sampleDefects: sample });
  }

  if (entries.length === 0) return {};

  const userPrompt = `Project: ${projectName}

Clusters to summarize:
${JSON.stringify(entries, null, 2)}`;

  try {
    const results = await callClaudeStep<{ clusterKey: string; claudeSummary: string; businessImpact: string; recommendation: string }[]>(
      CLUSTER_SUMMARY_SYSTEM,
      userPrompt,
      0.2,
      4096
    );

    if (!Array.isArray(results)) return {};
    return Object.fromEntries(results.map(r => [r.clusterKey, { claudeSummary: r.claudeSummary, businessImpact: r.businessImpact, recommendation: r.recommendation }]));
  } catch {
    return {};
  }
}

// ─── Step 4: Executive summary (qualitative + delta) ─────────────────────────

const EXEC_SUMMARY_SYSTEM = `You are a senior QA / delivery risk analyst writing an executive summary for a UAT defect report.

Your output is part of a structured JSON object. Rules:
- Return ONLY raw JSON — no prose, no markdown fences
- executiveSummary: 2-3 paragraphs covering overall quality posture, highest-risk areas, and trend vs previous run (if provided)
- qualityTrend: 2-3 sentences on open/closed rates and resolution velocity
- recurringPatterns: list of patterns with specific application names
- riskAreas: evidence-based risk areas with concrete recommendations
- preventionActions: specific, actionable items with effort estimates

Output schema:
{
  "executiveSummary": "string",
  "qualityTrend": "string",
  "recurringPatterns": [{ "pattern": "string", "occurrences": number, "applications": ["string"], "priority": "high|medium|low" }],
  "riskAreas": [{ "area": "string", "riskLevel": "high|medium|low", "rationale": "string", "recommendation": "string", "relatedApplications": ["string"] }],
  "preventionActions": [{ "action": "string", "priority": "high|medium|low", "targetApplication": "string", "effort": "low|medium|high" }]
}`;

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runUATPipeline(
  defects: Defect[],
  projectName: string,
  onProgress?: UATProgressCallback,
  context?: UATRunContext
): Promise<PipelineResult> {
  if (process.env.CLAUDE_MOCK === 'true') {
    onProgress?.('Mock mode — returning fixture data');
    return mockResult(defects, projectName);
  }

  // Step 1: local stats
  onProgress?.('Step 1/4 — Computing defect statistics…');
  const stats = computeStats(defects);

  // Step 2: taxonomy classification (deterministic, instant)
  onProgress?.('Step 2/4 — Classifying defects by category…');
  const rawClassifications = classifyDefects(defects.map(d => ({
    title: d.title,
    description: d.description,
    module: d.module,
    application: d.application,
  })));

  const classifications: DefectClassification[] = defects.map((d, i) => ({
    defectExternalId: d.id,
    clusterKey: rawClassifications[i].clusterKey,
    clusterName: rawClassifications[i].clusterName,
    method: rawClassifications[i].method,
    matchedKeywords: rawClassifications[i].matchedKeywords,
  }));

  const clusterMap = buildClusterStats(defects, classifications);

  // Build ClusterSummary[] from stats (without Claude summaries yet)
  const clusterSummariesPartial = new Map<string, Omit<ClusterSummary, 'claudeSummary' | 'businessImpact' | 'recommendation'>>();
  for (const [key, { name, defects: cd }] of clusterMap.entries()) {
    const appCount = new Map<string, number>();
    let critical = 0, high = 0, medium = 0, low = 0;
    for (const d of cd) {
      appCount.set(d.application, (appCount.get(d.application) || 0) + 1);
      if (d.priority === 'Critical') critical++;
      else if (d.priority === 'High') high++;
      else if (d.priority === 'Medium') medium++;
      else low++;
    }
    const riskScore = critical * 4 + high * 2 + medium * 1;
    const riskLevel: 'high' | 'medium' | 'low' = riskScore > 20 ? 'high' : riskScore > 8 ? 'medium' : 'low';
    const topApps = [...appCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);

    clusterSummariesPartial.set(key, {
      clusterKey: key,
      clusterName: name,
      defectCount: cd.length,
      criticalCount: critical,
      highCount: high,
      mediumCount: medium,
      lowCount: low,
      riskScore,
      riskLevel,
      topApplications: topApps,
    });
  }

  // Step 3: per-cluster Claude summaries
  onProgress?.('Step 3/4 — Generating cluster risk summaries…');
  const claudeSummaries = await generateClusterSummaries(clusterMap, projectName);

  const clusterSummaries: ClusterSummary[] = [...clusterSummariesPartial.entries()]
    .map(([key, partial]) => ({
      ...partial,
      claudeSummary: claudeSummaries[key]?.claudeSummary || '',
      businessImpact: claudeSummaries[key]?.businessImpact || '',
      recommendation: claudeSummaries[key]?.recommendation || '',
    }))
    .sort((a, b) => b.riskScore - a.riskScore);

  // Step 4: executive summary
  onProgress?.('Step 4/4 — Writing executive analysis…');

  const previousSummary = context?.previousResultJson
    ? (() => {
        try {
          const prev = JSON.parse(context.previousResultJson) as Partial<UATAnalysisResult>;
          return `\nPrevious run: ${prev.totalDefects ?? '?'} defects, risk level: ${prev.overallRiskLevel ?? '?'}`;
        } catch { return ''; }
      })()
    : '';

  const statsSummary = `
Project: ${projectName}
Total defects: ${defects.length}${previousSummary}

Priority breakdown:
${stats.byPriority.map(p => `  ${p.priority}: ${p.count} (${p.percentage}%)`).join('\n')}

By application (top 10 by risk score):
${stats.byApplication.slice(0, 10).map(a =>
  `  ${a.application}: ${a.total} total (Critical: ${a.critical}, High: ${a.high}, Medium: ${a.medium}, Low: ${a.low}) — RiskScore: ${a.riskScore}`
).join('\n')}

By cluster:
${clusterSummaries.map(c =>
  `  ${c.clusterName}: ${c.defectCount} defects (Critical: ${c.criticalCount}, High: ${c.highCount}) — RiskScore: ${c.riskScore}`
).join('\n')}

Sample defect detail (Critical + High priority):
${defectsToPromptText(defects.filter(d => d.priority === 'Critical' || d.priority === 'High'), 60)}`.trim();

  const claudeResult = await callClaudeStep<Pick<UATAnalysisResult, 'executiveSummary' | 'qualityTrend' | 'recurringPatterns' | 'riskAreas' | 'preventionActions'>>(
    EXEC_SUMMARY_SYSTEM,
    `Analyse this UAT defect data and return the JSON:\n\n${statsSummary}`,
    0.2,
    8192
  );

  const result: UATAnalysisResult = {
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
    clusterSummaries,
  };

  return { result, classifications };
}

// ─── Mock fixture ─────────────────────────────────────────────────────────────

function mockResult(defects: Defect[], projectName: string): PipelineResult {
  const statsDefects = defects.length > 0 ? defects : MOCK_DEFECTS;
  const stats = computeStats(statsDefects);

  const rawCls = classifyDefects(statsDefects.map(d => ({
    title: d.title, description: d.description, module: d.module, application: d.application,
  })));
  const classifications: DefectClassification[] = statsDefects.map((d, i) => ({
    defectExternalId: d.id,
    clusterKey: rawCls[i].clusterKey,
    clusterName: rawCls[i].clusterName,
    method: rawCls[i].method,
    matchedKeywords: rawCls[i].matchedKeywords,
  }));

  const clusterMap = buildClusterStats(statsDefects, classifications);
  const mockClusterSummaries: ClusterSummary[] = [...clusterMap.entries()].map(([key, { name, defects: cd }]) => {
    let critical = 0, high = 0, medium = 0, low = 0;
    const appCount = new Map<string, number>();
    for (const d of cd) {
      appCount.set(d.application, (appCount.get(d.application) || 0) + 1);
      if (d.priority === 'Critical') critical++;
      else if (d.priority === 'High') high++;
      else if (d.priority === 'Medium') medium++;
      else low++;
    }
    const riskScore = critical * 4 + high * 2 + medium * 1;
    return {
      clusterKey: key,
      clusterName: name,
      defectCount: cd.length,
      criticalCount: critical,
      highCount: high,
      mediumCount: medium,
      lowCount: low,
      riskScore,
      riskLevel: (riskScore > 20 ? 'high' : riskScore > 8 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
      topApplications: [...appCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a),
      claudeSummary: `[MOCK] ${name} cluster shows ${cd.length} defects with focus on ${[...appCount.keys()].slice(0, 2).join(', ') || 'multiple applications'}.`,
      businessImpact: '[MOCK] Unresolved defects in this cluster risk production incidents.',
      recommendation: '[MOCK] Prioritise unit test coverage and integration test automation for this area.',
    };
  }).sort((a, b) => b.riskScore - a.riskScore);

  const result: UATAnalysisResult = {
    executiveSummary: `[MOCK] ${projectName} UAT analysis — set CLAUDE_MOCK=false for real results. ${statsDefects.length} defects analysed across ${stats.byApplication.length} applications.`,
    overallRiskLevel: 'medium',
    totalDefects: statsDefects.length,
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
      { area: 'KFC–Oracle integration', riskLevel: 'high', rationale: '12 critical defects related to data sync', recommendation: 'Add integration test suite', relatedApplications: ['KFC', 'Oracle'] },
      { area: 'AOO session management', riskLevel: 'medium', rationale: 'Repeated session timeout defects', recommendation: 'Implement graceful re-auth flow', relatedApplications: ['AOO'] },
    ],
    preventionActions: [
      { action: 'Automate regression suite for KFC–Oracle data exchange', priority: 'high', targetApplication: 'KFC', effort: 'high' },
      { action: 'Add field-level validation unit tests for ESI forms', priority: 'medium', targetApplication: 'ESI', effort: 'low' },
    ],
    qualityTrend: '[MOCK] 68% of defects were closed within the sprint. Critical defects averaged 3-day resolution time.',
    clusterSummaries: mockClusterSummaries,
  };

  return { result, classifications };
}

const MOCK_DEFECTS: Defect[] = [
  { id: '1', title: 'Interest calc wrong', priority: 'Critical', severity: 'Critical', status: 'Closed', application: 'KFC', module: 'Calculations', description: 'Interest rate calculation incorrect for high-value accounts', resolution: '', detectedBy: '', assignedTo: '', detectedDate: '', closedDate: '', environment: '', rawRow: {} },
  { id: '2', title: 'Oracle sync fails on payment', priority: 'High', severity: 'High', status: 'Open', application: 'Oracle', module: 'Integration', description: 'Payment sync between KFC and Oracle GL fails', resolution: '', detectedBy: '', assignedTo: '', detectedDate: '', closedDate: '', environment: '', rawRow: {} },
  { id: '3', title: 'Session timeout on login', priority: 'Medium', severity: 'Medium', status: 'Closed', application: 'AOO', module: 'Auth', description: 'User session expires without proper auth redirect', resolution: '', detectedBy: '', assignedTo: '', detectedDate: '', closedDate: '', environment: '', rawRow: {} },
  { id: '4', title: 'Mandatory field validation missing', priority: 'High', severity: 'High', status: 'Open', application: 'ESI', module: 'Data', description: 'Required field not validated on form submission', resolution: '', detectedBy: '', assignedTo: '', detectedDate: '', closedDate: '', environment: '', rawRow: {} },
  { id: '5', title: 'KYC review report export fails', priority: 'Medium', severity: 'Medium', status: 'Open', application: 'KFC', module: 'KYC', description: 'PDF export of KYC review report throws error', resolution: '', detectedBy: '', assignedTo: '', detectedDate: '', closedDate: '', environment: '', rawRow: {} },
];
