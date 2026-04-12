import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { runExtractionPipeline, runGapAnalysisPipeline } from '../services/ingestionPipeline';
import type { DocumentVersion, FunctionalAnalysisRun, FunctionalGap } from '../types';

const router = Router();

function parseJsonField<T>(value: unknown, fallback: T | null = null): T {
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    console.warn('[functional] Failed to parse JSON field:', value);
    return fallback as T;
  }
}

// ─── Document Version Management ─────────────────────────────────────────────

// List document versions for a project (grouped by file)
router.get('/:projectId/versions', (req, res) => {
  const { projectId } = req.params;
  try {
    const versions = db.prepare(`
      SELECT dv.*, f.original_name, f.bucket, f.mime_type,
             (SELECT COUNT(*) FROM functional_components fc WHERE fc.document_version_id = dv.id) as component_count
      FROM document_versions dv
      JOIN files f ON dv.file_id = f.id
      WHERE f.project_id = ?
      ORDER BY dv.created_at DESC
    `).all(projectId);
    res.json(versions);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Create a new document version and trigger async extraction
router.post('/:projectId/versions', (req, res) => {
  const { projectId } = req.params;
  const { file_id, version_label } = req.body;

  if (!file_id) return res.status(400).json({ error: 'file_id required' });

  try {
    const file = db.prepare('SELECT id, project_id FROM files WHERE id = ? AND project_id = ?').get(file_id, projectId);
    if (!file) return res.status(404).json({ error: 'File not found in this project' });

    const existing = db.prepare('SELECT MAX(version_number) as max_ver FROM document_versions WHERE file_id = ?').get(file_id) as { max_ver: number | null };
    const versionNumber = (existing.max_ver ?? 0) + 1;

    const versionId = uuidv4();
    db.prepare(`
      INSERT INTO document_versions (id, file_id, version_number, version_label, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(versionId, file_id, versionNumber, version_label ?? `v${versionNumber}`);

    const version = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(versionId) as DocumentVersion;

    runExtractionPipeline(projectId, file_id, versionId, (step) => {
      console.log(`[functional] Version ${versionId}: ${step}`);
    }).catch(err => console.error('[functional] Extraction error:', err));

    res.json({ ...version, component_count: 0 });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// List components for a version (filterable by type)
router.get('/:projectId/versions/:versionId/components', (req, res) => {
  const { versionId } = req.params;
  const { type } = req.query;
  try {
    let query = 'SELECT id, document_version_id, type, title, description, condition_text, action_text, source_section, source_quote, confidence, created_at FROM functional_components WHERE document_version_id = ?';
    const params: unknown[] = [versionId];
    if (type && typeof type === 'string') { query += ' AND type = ?'; params.push(type); }
    query += ' ORDER BY type, title';
    res.json(db.prepare(query).all(...params));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Analysis Runs ────────────────────────────────────────────────────────────

// List runs for a project
router.get('/:projectId/runs', (req, res) => {
  const { projectId } = req.params;
  try {
    const runs = db.prepare(`
      SELECT far.*,
        (SELECT COUNT(*) FROM functional_gaps fg WHERE fg.run_id = far.id AND fg.status = 'confirmed') as confirmed_gap_count,
        (SELECT coverage_score FROM coverage_reports cr WHERE cr.run_id = far.id) as coverage_score
      FROM functional_analysis_runs far
      WHERE far.project_id = ?
      ORDER BY far.created_at DESC
    `).all(projectId) as Array<FunctionalAnalysisRun & { as_is_version_ids: string; to_be_version_ids: string; confirmed_gap_count: number; coverage_score: number | null }>;

    res.json(runs.map(r => ({
      ...r,
      as_is_version_ids: JSON.parse(r.as_is_version_ids),
      to_be_version_ids: JSON.parse(r.to_be_version_ids),
    })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Create a new gap analysis run
router.post('/:projectId/runs', (req, res) => {
  const { projectId } = req.params;
  const { as_is_version_ids, to_be_version_ids } = req.body;

  if (!Array.isArray(as_is_version_ids) || !Array.isArray(to_be_version_ids)) {
    return res.status(400).json({ error: 'as_is_version_ids and to_be_version_ids must be arrays' });
  }
  if (as_is_version_ids.length === 0 || to_be_version_ids.length === 0) {
    return res.status(400).json({ error: 'At least one AS-IS and one TO-BE version required' });
  }

  try {
    const runId = uuidv4();
    db.prepare(`
      INSERT INTO functional_analysis_runs (id, project_id, as_is_version_ids, to_be_version_ids, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(runId, projectId, JSON.stringify(as_is_version_ids), JSON.stringify(to_be_version_ids));

    const run = db.prepare('SELECT * FROM functional_analysis_runs WHERE id = ?').get(runId) as FunctionalAnalysisRun & { as_is_version_ids: string; to_be_version_ids: string };

    runGapAnalysisPipeline(runId, (step) => {
      console.log(`[functional] Run ${runId}: ${step}`);
    }).catch(err => console.error('[functional] Pipeline error:', err));

    res.json({ ...run, as_is_version_ids, to_be_version_ids });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get run detail (with gaps + coverage)
router.get('/:projectId/runs/:runId', (req, res) => {
  const { runId } = req.params;
  try {
    const run = db.prepare('SELECT * FROM functional_analysis_runs WHERE id = ?').get(runId) as
      | (FunctionalAnalysisRun & { as_is_version_ids: string; to_be_version_ids: string })
      | undefined;
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const gaps = db.prepare("SELECT * FROM functional_gaps WHERE run_id = ? AND status = 'confirmed' ORDER BY gap_type, created_at").all(runId) as Array<FunctionalGap & { field_diffs: string }>;
    const coverage = db.prepare('SELECT * FROM coverage_reports WHERE run_id = ?').get(runId);

    const asIsVersionIds: string[] = JSON.parse(run.as_is_version_ids);
    const toBeVersionIds: string[] = JSON.parse(run.to_be_version_ids);

    const countComponents = (ids: string[]) => {
      if (ids.length === 0) return 0;
      const placeholders = ids.map(() => '?').join(',');
      return (db.prepare(`SELECT COUNT(*) as cnt FROM functional_components WHERE document_version_id IN (${placeholders})`).get(...ids) as { cnt: number }).cnt;
    };

    res.json({
      ...run,
      as_is_version_ids: asIsVersionIds,
      to_be_version_ids: toBeVersionIds,
      gaps: gaps.map(g => ({ ...g, field_diffs: parseJsonField(g.field_diffs) })),
      coverage: coverage ?? null,
      as_is_component_count: countComponents(asIsVersionIds),
      to_be_component_count: countComponents(toBeVersionIds),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get gaps for a run (filterable)
router.get('/:projectId/runs/:runId/gaps', (req, res) => {
  const { runId } = req.params;
  const { gap_type, min_confidence } = req.query;
  try {
    let query = "SELECT fg.*, ap.as_is_component_id, ap.to_be_component_id FROM functional_gaps fg JOIN alignment_pairs ap ON fg.alignment_pair_id = ap.id WHERE fg.run_id = ? AND fg.status = 'confirmed'";
    const params: unknown[] = [runId];
    if (gap_type) { query += ' AND fg.gap_type = ?'; params.push(gap_type); }
    if (min_confidence) {
      const minConf = parseFloat(min_confidence as string);
      if (isNaN(minConf)) return res.status(400).json({ error: 'min_confidence must be a number' });
      query += ' AND fg.confidence >= ?';
      params.push(minConf);
    }
    query += ' ORDER BY fg.gap_type, fg.created_at';

    const gaps = db.prepare(query).all(...params) as Array<FunctionalGap & { field_diffs: string }>;
    res.json(gaps.map(g => ({ ...g, field_diffs: parseJsonField(g.field_diffs) })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get coverage report for a run
router.get('/:projectId/runs/:runId/coverage', (req, res) => {
  const { runId } = req.params;
  try {
    const coverage = db.prepare('SELECT * FROM coverage_reports WHERE run_id = ?').get(runId);
    if (!coverage) return res.status(404).json({ error: 'Coverage report not yet available' });
    res.json(coverage);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get impacts for a specific gap
router.get('/:projectId/runs/:runId/gaps/:gapId/impacts', (req, res) => {
  const { gapId } = req.params;
  try {
    const impacts = db.prepare(`
      SELECT gi.*, fc.title, fc.type, fc.description
      FROM gap_impacts gi
      JOIN functional_components fc ON gi.affected_component_id = fc.id
      WHERE gi.gap_id = ?
    `).all(gapId) as Array<Record<string, unknown>>;
    res.json(impacts.map(i => ({
      ...i,
      relationship_path: parseJsonField(i.relationship_path),
    })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Delete a run
router.delete('/:projectId/runs/:runId', (req, res) => {
  const { runId } = req.params;
  try {
    db.prepare('DELETE FROM functional_analysis_runs WHERE id = ?').run(runId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
