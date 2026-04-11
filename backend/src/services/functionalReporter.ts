import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import type { FunctionalGap, FunctionalAnalysisRun, CoverageReport, FunctionalRunDetail } from '../types';

function parseGap(row: Record<string, unknown>): FunctionalGap {
  return {
    ...row,
    field_diffs: typeof row.field_diffs === 'string' ? JSON.parse(row.field_diffs) : (row.field_diffs ?? []),
  } as FunctionalGap;
}

function countComponents(versionIds: string[]): number {
  if (versionIds.length === 0) return 0;
  const placeholders = versionIds.map(() => '?').join(',');
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM functional_components WHERE document_version_id IN (${placeholders})`).get(...versionIds) as { cnt: number };
  return row.cnt;
}

export function computeCoverage(runId: string): CoverageReport {
  const existing = db.prepare('SELECT * FROM coverage_reports WHERE run_id = ?').get(runId) as CoverageReport | undefined;
  if (existing) return existing;

  const run = db.prepare('SELECT as_is_version_ids FROM functional_analysis_runs WHERE id = ?').get(runId) as { as_is_version_ids: string } | undefined;
  const asIsVersionIds: string[] = run ? JSON.parse(run.as_is_version_ids) : [];
  const totalAsIs = countComponents(asIsVersionIds);

  const counts = db.prepare(`
    SELECT gap_type, COUNT(*) as cnt
    FROM functional_gaps
    WHERE run_id = ? AND status = 'confirmed'
    GROUP BY gap_type
  `).all(runId) as Array<{ gap_type: string; cnt: number }>;

  const countMap = Object.fromEntries(counts.map(r => [r.gap_type, r.cnt]));
  const unchanged = countMap['unchanged'] ?? 0;
  const modified = countMap['modified'] ?? 0;
  const missing = countMap['missing'] ?? 0;
  const newInToBe = countMap['new'] ?? 0;
  const coverageScore = totalAsIs > 0 ? (unchanged + modified) / totalAsIs : 0;

  const report: CoverageReport = {
    id: uuidv4(),
    run_id: runId,
    total_as_is_components: totalAsIs,
    unchanged_count: unchanged,
    modified_count: modified,
    missing_count: missing,
    new_count: newInToBe,
    coverage_score: Math.round(coverageScore * 1000) / 1000,
    created_at: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO coverage_reports (id, run_id, total_as_is_components, unchanged_count, modified_count, missing_count, new_count, coverage_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(report.id, report.run_id, report.total_as_is_components, report.unchanged_count, report.modified_count, report.missing_count, report.new_count, report.coverage_score);

  return report;
}

export function buildRunReport(runId: string): FunctionalRunDetail {
  const run = db.prepare('SELECT * FROM functional_analysis_runs WHERE id = ?').get(runId) as (Omit<FunctionalAnalysisRun, 'as_is_version_ids' | 'to_be_version_ids'> & { as_is_version_ids: string; to_be_version_ids: string }) | undefined;
  if (!run) throw new Error(`Run not found: ${runId}`);

  const asIsVersionIds: string[] = JSON.parse(run.as_is_version_ids);
  const toBeVersionIds: string[] = JSON.parse(run.to_be_version_ids);

  const gaps = (db.prepare("SELECT * FROM functional_gaps WHERE run_id = ? AND status = 'confirmed' ORDER BY gap_type, created_at").all(runId) as Record<string, unknown>[]).map(parseGap);
  const coverage = computeCoverage(runId);

  return {
    ...run,
    as_is_version_ids: asIsVersionIds,
    to_be_version_ids: toBeVersionIds,
    gaps,
    coverage,
    as_is_component_count: countComponents(asIsVersionIds),
    to_be_component_count: countComponents(toBeVersionIds),
  };
}
