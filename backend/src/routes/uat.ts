import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../db';
import { parseALMExcel } from '../services/almParser';
import { runUATPipeline } from '../services/uatPipeline';
import { DEFAULT_TAXONOMY, classifyDefects } from '../services/taxonomy';
import type { UATAnalysis } from '../types';

const router = Router();

const tmpUpload = multer({
  dest: path.resolve('./tmp-uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) and CSV files are accepted'));
    }
  },
});

// ─── GET /api/uat/:projectId — list UAT analyses ──────────────────────────────
router.get('/:projectId', (req: Request, res: Response) => {
  try {
    const rows = db.prepare(
      'SELECT * FROM uat_analyses WHERE project_id = ? ORDER BY created_at DESC'
    ).all(req.params.projectId);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch UAT analyses' });
  }
});

// ─── GET /api/uat/:projectId/:analysisId — get one ────────────────────────────
router.get('/:projectId/:analysisId', (req: Request, res: Response) => {
  try {
    const row = db.prepare(
      'SELECT * FROM uat_analyses WHERE id = ? AND project_id = ?'
    ).get(req.params.analysisId, req.params.projectId);
    if (!row) return res.status(404).json({ error: 'UAT analysis not found' });
    res.json(row);
  } catch {
    res.status(500).json({ error: 'Failed to fetch UAT analysis' });
  }
});

// ─── GET /api/uat/:projectId/:analysisId/clusters — cluster summary list ──────
router.get('/:projectId/:analysisId/clusters', (req: Request, res: Response) => {
  try {
    const { analysisId, projectId } = req.params as { analysisId: string; projectId: string };

    const analysis = db.prepare(
      'SELECT id FROM uat_analyses WHERE id = ? AND project_id = ?'
    ).get(analysisId, projectId);
    if (!analysis) return res.status(404).json({ error: 'UAT analysis not found' });

    // Aggregate cluster_assignments to return cluster summaries with counts
    const rows = db.prepare(`
      SELECT
        ca.cluster_key,
        ca.cluster_name,
        COUNT(*) as defect_count,
        SUM(CASE WHEN d.priority = 'Critical' THEN 1 ELSE 0 END) as critical_count,
        SUM(CASE WHEN d.priority = 'High' THEN 1 ELSE 0 END) as high_count,
        SUM(CASE WHEN d.priority = 'Medium' THEN 1 ELSE 0 END) as medium_count,
        SUM(CASE WHEN d.priority = 'Low' THEN 1 ELSE 0 END) as low_count
      FROM cluster_assignments ca
      JOIN defects d ON d.id = ca.defect_id
      WHERE ca.uat_analysis_id = ?
      GROUP BY ca.cluster_key, ca.cluster_name
      ORDER BY (SUM(CASE WHEN d.priority = 'Critical' THEN 4 ELSE 0 END) +
                SUM(CASE WHEN d.priority = 'High' THEN 2 ELSE 0 END) +
                SUM(CASE WHEN d.priority = 'Medium' THEN 1 ELSE 0 END)) DESC
    `).all(analysisId);

    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch cluster summaries' });
  }
});

// ─── GET /api/uat/:projectId/:analysisId/clusters/:clusterKey/defects ─────────
router.get('/:projectId/:analysisId/clusters/:clusterKey/defects', (req: Request, res: Response) => {
  try {
    const { analysisId, projectId, clusterKey } = req.params as {
      analysisId: string;
      projectId: string;
      clusterKey: string;
    };

    const analysis = db.prepare(
      'SELECT id FROM uat_analyses WHERE id = ? AND project_id = ?'
    ).get(analysisId, projectId);
    if (!analysis) return res.status(404).json({ error: 'UAT analysis not found' });

    const rows = db.prepare(`
      SELECT
        d.id,
        d.external_id,
        d.title,
        d.priority,
        d.status,
        d.application,
        d.module,
        d.description,
        d.resolution,
        d.detected_by,
        d.assigned_to,
        d.detected_date,
        d.closed_date,
        d.environment,
        ca.method as classification_method,
        ca.matched_keywords,
        ro.id             as override_id,
        ro.overridden_priority,
        ro.reason         as override_reason,
        ro.updated_at     as override_date
      FROM cluster_assignments ca
      JOIN defects d ON d.id = ca.defect_id
      LEFT JOIN risk_overrides ro ON ro.defect_id = d.id
      WHERE ca.uat_analysis_id = ?
        AND ca.cluster_key = ?
      ORDER BY
        CASE COALESCE(ro.overridden_priority, d.priority)
          WHEN 'Critical' THEN 1
          WHEN 'High'     THEN 2
          WHEN 'Medium'   THEN 3
          WHEN 'Low'      THEN 4
          ELSE 5
        END,
        d.title
    `).all(analysisId, clusterKey);

    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch cluster defects' });
  }
});

// ─── GET /api/uat/:projectId/cluster-trend — per-cluster series across all runs ─
router.get('/:projectId/cluster-trend', (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };

    // Raw rows: one row per (analysis × cluster)
    const rows = db.prepare(`
      SELECT
        ua.id          AS analysis_id,
        ua.version_name,
        ua.created_at  AS run_date,
        ua.defect_count AS total_defects,
        ca.cluster_key,
        ca.cluster_name,
        COUNT(*)        AS defect_count,
        SUM(CASE WHEN d.priority = 'Critical' THEN 4
                 WHEN d.priority = 'High'     THEN 2
                 WHEN d.priority = 'Medium'   THEN 1
                 ELSE 0 END)                  AS risk_score,
        SUM(CASE WHEN d.priority = 'Critical' THEN 1 ELSE 0 END) AS critical_count,
        SUM(CASE WHEN d.priority = 'High'     THEN 1 ELSE 0 END) AS high_count,
        SUM(CASE WHEN d.priority = 'Medium'   THEN 1 ELSE 0 END) AS medium_count,
        SUM(CASE WHEN d.priority = 'Low'      THEN 1 ELSE 0 END) AS low_count
      FROM uat_analyses ua
      JOIN cluster_assignments ca ON ca.uat_analysis_id = ua.id
      JOIN defects d ON d.id = ca.defect_id
      WHERE ua.project_id = ? AND ua.status = 'done'
      GROUP BY ua.id, ua.version_name, ua.created_at, ua.defect_count, ca.cluster_key, ca.cluster_name
      ORDER BY ua.created_at ASC, ca.cluster_key
    `).all(projectId) as {
      analysis_id: string; version_name: string; run_date: string; total_defects: number;
      cluster_key: string; cluster_name: string; defect_count: number; risk_score: number;
      critical_count: number; high_count: number; medium_count: number; low_count: number;
    }[];

    // Reshape: runs list + per-cluster point arrays
    const runMap = new Map<string, { analysisId: string; versionName: string; date: string; totalDefects: number }>();
    const clusterMap = new Map<string, { clusterKey: string; clusterName: string; points: Map<string, { defectCount: number; riskScore: number; criticalCount: number; highCount: number; mediumCount: number; lowCount: number }> }>();

    for (const r of rows) {
      if (!runMap.has(r.analysis_id)) {
        runMap.set(r.analysis_id, { analysisId: r.analysis_id, versionName: r.version_name, date: r.run_date, totalDefects: r.total_defects ?? 0 });
      }
      if (!clusterMap.has(r.cluster_key)) {
        clusterMap.set(r.cluster_key, { clusterKey: r.cluster_key, clusterName: r.cluster_name, points: new Map() });
      }
      clusterMap.get(r.cluster_key)!.points.set(r.analysis_id, {
        defectCount: r.defect_count, riskScore: r.risk_score,
        criticalCount: r.critical_count, highCount: r.high_count,
        mediumCount: r.medium_count, lowCount: r.low_count,
      });
    }

    const runs = [...runMap.values()];
    const clusters = [...clusterMap.values()].map(c => ({
      clusterKey: c.clusterKey,
      clusterName: c.clusterName,
      // one point per run (0 if cluster had no defects in that run)
      points: runs.map(r => c.points.get(r.analysisId) ?? { defectCount: 0, riskScore: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0 }),
    }));

    res.json({ runs, clusters });
  } catch {
    res.status(500).json({ error: 'Failed to fetch cluster trend' });
  }
});

// ─── GET /api/uat/:projectId/taxonomy — get project taxonomy (DB or defaults) ─
router.get('/:projectId/taxonomy', (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const rows = db.prepare(
      'SELECT * FROM cluster_configs WHERE project_id = ? ORDER BY sort_order ASC, cluster_key ASC'
    ).all(projectId) as { id: string; cluster_key: string; cluster_name: string; keywords: string; sort_order: number }[];

    if (rows.length > 0) {
      res.json(rows.map(r => ({ ...r, keywords: JSON.parse(r.keywords) })));
    } else {
      // Return defaults (not yet saved to DB)
      res.json(DEFAULT_TAXONOMY.map((c, i) => ({ id: null, cluster_key: c.key, cluster_name: c.name, keywords: c.keywords, sort_order: i })));
    }
  } catch {
    res.status(500).json({ error: 'Failed to fetch taxonomy' });
  }
});

// ─── PUT /api/uat/:projectId/taxonomy — save full taxonomy for project ─────────
router.put('/:projectId/taxonomy', (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const clusters = req.body as { cluster_key: string; cluster_name: string; keywords: string[] }[];

    if (!Array.isArray(clusters)) return res.status(400).json({ error: 'Body must be an array of clusters' });

    const upsert = db.prepare(`
      INSERT INTO cluster_configs (id, project_id, cluster_key, cluster_name, keywords, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(project_id, cluster_key) DO UPDATE SET
        cluster_name = excluded.cluster_name,
        keywords     = excluded.keywords,
        sort_order   = excluded.sort_order,
        updated_at   = datetime('now')
    `);

    // Delete clusters no longer in the list
    const keys = clusters.map(c => c.cluster_key);
    if (keys.length > 0) {
      db.prepare(
        `DELETE FROM cluster_configs WHERE project_id = ? AND cluster_key NOT IN (${keys.map(() => '?').join(',')})`
      ).run(projectId, ...keys);
    }

    const save = db.transaction(() => {
      clusters.forEach((c, i) => {
        upsert.run(uuidv4(), projectId, c.cluster_key, c.cluster_name, JSON.stringify(c.keywords ?? []), i);
      });
    });
    save();

    res.json({ success: true, saved: clusters.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save taxonomy';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/uat/:projectId/recluster — re-classify all defects with current taxonomy ─
router.post('/:projectId/recluster', async (req: Request, res: Response) => {
  const { projectId } = req.params as { projectId: string };
  try {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Load taxonomy (DB config or defaults)
    const configRows = db.prepare(
      'SELECT cluster_key, cluster_name, keywords FROM cluster_configs WHERE project_id = ? ORDER BY sort_order ASC'
    ).all(projectId) as { cluster_key: string; cluster_name: string; keywords: string }[];

    const taxonomy = configRows.length > 0
      ? configRows.map(r => ({ key: r.cluster_key, name: r.cluster_name, keywords: JSON.parse(r.keywords) as string[] }))
      : DEFAULT_TAXONOMY.map(c => ({ key: c.key, name: c.name, keywords: c.keywords }));

    // Get all ingestion runs for this project
    const ingestionRuns = db.prepare(
      'SELECT ir.id as run_id, ua.id as analysis_id FROM ingestion_runs ir JOIN uat_analyses ua ON ua.id = ir.uat_analysis_id WHERE ir.project_id = ?'
    ).all(projectId) as { run_id: string; analysis_id: string }[];

    res.json({ message: 'Re-clustering started', runs: ingestionRuns.length });

    // Run async
    reclusterAsync(projectId, ingestionRuns, taxonomy).catch(err =>
      console.error('[uat] Re-cluster error:', err)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Re-cluster failed';
    res.status(500).json({ error: msg });
  }
});

async function reclusterAsync(
  projectId: string,
  ingestionRuns: { run_id: string; analysis_id: string }[],
  taxonomy: { key: string; name: string; keywords: string[] }[]
) {
  console.log(`[uat] Re-clustering ${ingestionRuns.length} runs for project ${projectId}`);
  let totalAssigned = 0;

  for (const { run_id, analysis_id } of ingestionRuns) {
    // Load defects for this run
    const defects = db.prepare(
      'SELECT id, title, description, module, application FROM defects WHERE ingestion_run_id = ?'
    ).all(run_id) as { id: string; title: string; description: string; module: string; application: string }[];

    if (defects.length === 0) continue;

    // Classify with current taxonomy
    const classifyWithTaxonomy = (d: typeof defects[0]) => {
      const text = `${d.title} ${d.description} ${d.module}`.toLowerCase();
      let bestCluster: typeof taxonomy[0] | null = null;
      let bestMatches: string[] = [];
      for (const cluster of taxonomy) {
        const matched = cluster.keywords.filter(kw => text.includes(kw.toLowerCase()));
        if (matched.length > bestMatches.length) { bestCluster = cluster; bestMatches = matched; }
      }
      return bestCluster && bestMatches.length > 0
        ? { clusterKey: bestCluster.key, clusterName: bestCluster.name, method: 'rule', matchedKeywords: bestMatches.join(', ') }
        : { clusterKey: 'other', clusterName: 'Other', method: 'unclassified', matchedKeywords: '' };
    };

    const deleteAndInsert = db.transaction(() => {
      db.prepare('DELETE FROM cluster_assignments WHERE uat_analysis_id = ?').run(analysis_id);
      const insertAssignment = db.prepare(`
        INSERT INTO cluster_assignments (id, uat_analysis_id, defect_id, cluster_key, cluster_name, method, matched_keywords)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const d of defects) {
        const cls = classifyWithTaxonomy(d);
        insertAssignment.run(uuidv4(), analysis_id, d.id, cls.clusterKey, cls.clusterName, cls.method, cls.matchedKeywords);
      }
    });
    deleteAndInsert();
    totalAssigned += defects.length;
  }

  console.log(`[uat] Re-cluster complete: ${totalAssigned} assignments across ${ingestionRuns.length} runs`);
}

// ─── GET /api/uat/:projectId/defects — all defects for a project (all runs) ───
router.get('/:projectId/defects/all', (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const limit = Math.min(parseInt((req.query.limit as string) || '500', 10), 1000);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    const rows = db.prepare(`
      SELECT d.*, ir.file_name, ir.created_at as run_date
      FROM defects d
      JOIN ingestion_runs ir ON ir.id = d.ingestion_run_id
      WHERE d.project_id = ?
      ORDER BY ir.created_at DESC, d.priority ASC, d.title ASC
      LIMIT ? OFFSET ?
    `).all(projectId, limit, offset);

    const total = (db.prepare('SELECT COUNT(*) as c FROM defects WHERE project_id = ?').get(projectId) as { c: number }).c;

    res.json({ defects: rows, total, limit, offset });
  } catch {
    res.status(500).json({ error: 'Failed to fetch defects' });
  }
});

// ─── GET /api/uat/:projectId/overrides — project-level audit trail ────────────
router.get('/:projectId/overrides', (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const rows = db.prepare(`
      SELECT
        ro.id,
        ro.defect_id,
        ro.original_priority,
        ro.overridden_priority,
        ro.reason,
        ro.created_at,
        ro.updated_at,
        d.external_id,
        d.title,
        d.application,
        d.module
      FROM risk_overrides ro
      JOIN defects d ON d.id = ro.defect_id
      WHERE ro.project_id = ?
      ORDER BY ro.updated_at DESC
    `).all(projectId);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch overrides' });
  }
});

// ─── POST /api/uat/:projectId/defects/:defectId/override — set override ───────
router.post('/:projectId/defects/:defectId/override', (req: Request, res: Response) => {
  try {
    const { projectId, defectId } = req.params as { projectId: string; defectId: string };
    const { overriddenPriority, reason } = req.body as { overriddenPriority: string; reason: string };

    if (!overriddenPriority || !['Critical', 'High', 'Medium', 'Low'].includes(overriddenPriority)) {
      return res.status(400).json({ error: 'overriddenPriority must be Critical, High, Medium, or Low' });
    }
    if (!reason?.trim()) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const defect = db.prepare(
      'SELECT id, priority FROM defects WHERE id = ? AND project_id = ?'
    ).get(defectId, projectId) as { id: string; priority: string } | undefined;
    if (!defect) return res.status(404).json({ error: 'Defect not found' });

    const existing = db.prepare('SELECT id FROM risk_overrides WHERE defect_id = ?').get(defectId) as { id: string } | undefined;
    if (existing) {
      db.prepare(`
        UPDATE risk_overrides
        SET overridden_priority = ?, reason = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(overriddenPriority, reason.trim(), existing.id);
    } else {
      db.prepare(`
        INSERT INTO risk_overrides (id, defect_id, project_id, original_priority, overridden_priority, reason)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), defectId, projectId, defect.priority, overriddenPriority, reason.trim());
    }

    const saved = db.prepare('SELECT * FROM risk_overrides WHERE defect_id = ?').get(defectId);
    res.json(saved);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save override';
    res.status(500).json({ error: msg });
  }
});

// ─── DELETE /api/uat/:projectId/defects/:defectId/override — remove override ──
router.delete('/:projectId/defects/:defectId/override', (req: Request, res: Response) => {
  try {
    const { projectId, defectId } = req.params as { projectId: string; defectId: string };
    const defect = db.prepare('SELECT id FROM defects WHERE id = ? AND project_id = ?').get(defectId, projectId);
    if (!defect) return res.status(404).json({ error: 'Defect not found' });

    db.prepare('DELETE FROM risk_overrides WHERE defect_id = ?').run(defectId);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to remove override' });
  }
});

// ─── POST /api/uat/:projectId/run — upload ALM file + trigger analysis ────────
router.post('/:projectId/run', tmpUpload.single('file'), async (req: Request, res: Response) => {
  const projectId = req.params.projectId as string;
  const tmpFilePath = req.file?.path;

  try {
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined;
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const fileBuffer = fs.readFileSync(req.file.path);
    const parsed = parseALMExcel(fileBuffer);

    if (parsed.defects.length === 0) {
      return res.status(400).json({
        error: 'No defects found in the uploaded file. Please verify it is a valid ALM export.',
      });
    }

    const count = (db.prepare('SELECT COUNT(*) as c FROM uat_analyses WHERE project_id = ?').get(projectId) as { c: number }).c;
    const versionName = `UAT Analysis v${count + 1}`;
    const analysisId = uuidv4();

    db.prepare(`
      INSERT INTO uat_analyses (id, project_id, version_name, status, file_name, defect_count)
      VALUES (?, ?, ?, 'running', ?, ?)
    `).run(analysisId, projectId, versionName, req.file.originalname, parsed.defects.length);

    // Persist ingestion run
    const ingestionRunId = uuidv4();
    db.prepare(`
      INSERT INTO ingestion_runs (id, project_id, uat_analysis_id, file_name, defect_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(ingestionRunId, projectId, analysisId, req.file.originalname, parsed.defects.length);

    // Persist normalized defects
    const insertDefect = db.prepare(`
      INSERT INTO defects
        (id, external_id, project_id, ingestion_run_id, title, priority, status, application, module, description, resolution, detected_by, assigned_to, detected_date, closed_date, environment)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction(() => {
      for (const d of parsed.defects) {
        insertDefect.run(
          uuidv4(), d.id, projectId, ingestionRunId,
          d.title, d.priority, d.status,
          d.application || 'Unknown', d.module || '',
          d.description.slice(0, 2000),
          d.resolution.slice(0, 1000),
          d.detectedBy, d.assignedTo,
          d.detectedDate, d.closedDate, d.environment
        );
      }
    });
    insertMany();

    // Load previous run for delta context
    const prevAnalysis = db.prepare(
      "SELECT result_json FROM uat_analyses WHERE project_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1"
    ).get(projectId) as { result_json: string | null } | undefined;

    res.status(202).json({
      analysisId,
      versionName,
      status: 'running',
      defectCount: parsed.defects.length,
      detectedColumns: parsed.detectedColumns,
    });

    runUATAsync(analysisId, projectId, project.name, parsed.defects, req.file.originalname, ingestionRunId, prevAnalysis?.result_json ?? null)
      .catch(err => console.error('[uat] Async error:', err));

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start UAT analysis';
    res.status(500).json({ error: msg });
  } finally {
    if (tmpFilePath && fs.existsSync(tmpFilePath)) {
      try { fs.unlinkSync(tmpFilePath); } catch (_) {}
    }
  }
});

// ─── DELETE /api/uat/:projectId/:analysisId ───────────────────────────────────
router.delete('/:projectId/:analysisId', (req: Request, res: Response) => {
  try {
    const row = db.prepare(
      'SELECT id FROM uat_analyses WHERE id = ? AND project_id = ?'
    ).get(req.params.analysisId, req.params.projectId);
    if (!row) return res.status(404).json({ error: 'UAT analysis not found' });

    db.prepare('DELETE FROM uat_analyses WHERE id = ?').run(req.params.analysisId);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete UAT analysis' });
  }
});

// ─── Async runner ─────────────────────────────────────────────────────────────

async function runUATAsync(
  analysisId: string,
  projectId: string,
  projectName: string,
  defects: import('../services/almParser').Defect[],
  fileName: string,
  ingestionRunId: string,
  previousResultJson: string | null
) {
  const setProgress = (step: string) => {
    db.prepare("UPDATE uat_analyses SET progress_step = ? WHERE id = ?").run(step, analysisId);
  };

  try {
    console.log(`[uat] Running pipeline ${analysisId} — ${defects.length} defects from ${fileName}`);

    const { result, classifications } = await runUATPipeline(
      defects,
      projectName,
      setProgress,
      { projectName, previousResultJson }
    );

    // Persist cluster assignments — look up defect DB ids by external_id
    const defectRows = db.prepare(
      'SELECT id, external_id FROM defects WHERE ingestion_run_id = ?'
    ).all(ingestionRunId) as { id: string; external_id: string }[];

    const externalToDbId = new Map(defectRows.map(r => [r.external_id, r.id]));

    const insertAssignment = db.prepare(`
      INSERT INTO cluster_assignments (id, uat_analysis_id, defect_id, cluster_key, cluster_name, method, matched_keywords)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAssignments = db.transaction(() => {
      for (const cls of classifications) {
        const dbId = externalToDbId.get(cls.defectExternalId);
        if (!dbId) continue;
        insertAssignment.run(
          uuidv4(), analysisId, dbId,
          cls.clusterKey, cls.clusterName, cls.method,
          cls.matchedKeywords.join(', ')
        );
      }
    });
    insertAssignments();

    db.prepare(`
      UPDATE uat_analyses
      SET status = 'done', result_json = ?, defect_count = ?, progress_step = NULL
      WHERE id = ?
    `).run(JSON.stringify(result), result.totalDefects, analysisId);

    db.prepare(`UPDATE projects SET updated_at = datetime('now') WHERE id = ?`).run(projectId);
    console.log(`[uat] Completed ${analysisId} — ${classifications.length} assignments stored`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'UAT analysis failed';
    console.error(`[uat] Failed ${analysisId}:`, msg);
    db.prepare("UPDATE uat_analyses SET status = 'error', error_message = ?, progress_step = NULL WHERE id = ?")
      .run(msg, analysisId);
  }
}

export default router;
