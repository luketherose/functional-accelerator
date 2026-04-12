import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import db from '../db';
import { parseALMExcel } from '../services/almParser';
import { runUATPipeline } from '../services/uatPipeline';
import { DEFAULT_TAXONOMY, classifyDefects } from '../services/taxonomy';
import { suggestClusters } from '../services/clusterSuggestions';
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

// NOTE: GET /:projectId/:analysisId is intentionally placed AFTER all specific
// two-segment routes (cluster-trend, taxonomy, overrides, compare, etc.) to avoid
// Express matching those routes as `:analysisId`. See further below.

// ─── GET /api/uat/:projectId/:analysisId/clusters — cluster summary list ──────
router.get('/:projectId/:analysisId/clusters', (req: Request, res: Response) => {
  try {
    const { analysisId, projectId } = req.params as { analysisId: string; projectId: string };

    const analysis = db.prepare(
      'SELECT id FROM uat_analyses WHERE id = ? AND project_id = ?'
    ).get(analysisId, projectId);
    if (!analysis) return res.status(404).json({ error: 'UAT analysis not found' });

    // Aggregate cluster_assignments to return cluster summaries with counts.
    // COALESCE(ro.overridden_priority, d.priority) ensures risk overrides are reflected.
    const rows = db.prepare(`
      SELECT
        ca.cluster_key,
        ca.cluster_name,
        COUNT(*) as defect_count,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Critical' THEN 1 ELSE 0 END) as critical_count,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'High' THEN 1 ELSE 0 END) as high_count,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Medium' THEN 1 ELSE 0 END) as medium_count,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Low' THEN 1 ELSE 0 END) as low_count
      FROM cluster_assignments ca
      JOIN defects d ON d.id = ca.defect_id
      LEFT JOIN risk_overrides ro ON ro.defect_id = d.id
      WHERE ca.uat_analysis_id = ?
      GROUP BY ca.cluster_key, ca.cluster_name
      ORDER BY (SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Critical' THEN 4 ELSE 0 END) +
                SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'High' THEN 2 ELSE 0 END) +
                SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Medium' THEN 1 ELSE 0 END)) DESC
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
      res.json(rows.map(r => {
        let keywords: string[] = [];
        try { keywords = JSON.parse(r.keywords); } catch { /* keep empty array */ }
        return { ...r, keywords };
      }));
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
      ? configRows.map(r => {
          let keywords: string[] = [];
          try { keywords = JSON.parse(r.keywords) as string[]; } catch { /* keep empty */ }
          return { key: r.cluster_key, name: r.cluster_name, keywords };
        })
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
    const rawLimit = parseInt((req.query.limit as string) || '500', 10);
    const rawOffset = parseInt((req.query.offset as string) || '0', 10);
    if (isNaN(rawLimit) || isNaN(rawOffset)) {
      return res.status(400).json({ error: 'limit and offset must be integers' });
    }
    const limit = Math.min(Math.max(rawLimit, 1), 1000);
    const offset = Math.max(rawOffset, 0);

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

// ─── POST /api/uat/:projectId/suggest-clusters — Phase 2D: discover hidden themes ─
router.post('/:projectId/suggest-clusters', async (req: Request, res: Response) => {
  const { projectId } = req.params as { projectId: string };
  try {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Fetch all "other" defects across all runs for this project
    const otherDefects = db.prepare(`
      SELECT DISTINCT d.id, d.external_id, d.title, d.description
      FROM cluster_assignments ca
      JOIN defects d ON d.id = ca.defect_id
      WHERE d.project_id = ? AND ca.cluster_key = 'other'
      ORDER BY d.title
    `).all(projectId) as { id: string; external_id: string; title: string; description: string }[];

    if (otherDefects.length < 2) {
      return res.json({ suggestions: [], otherCount: otherDefects.length, coveredCount: 0 });
    }

    // Load existing cluster names (to avoid suggesting duplicates)
    const configRows = db.prepare(
      'SELECT cluster_name FROM cluster_configs WHERE project_id = ?'
    ).all(projectId) as { cluster_name: string }[];
    const existingNames = configRows.length > 0
      ? configRows.map(r => r.cluster_name)
      : DEFAULT_TAXONOMY.map(c => c.name);

    console.log(`[uat] Suggesting clusters for ${otherDefects.length} unclassified defects in project ${projectId}`);

    const result = await suggestClusters(
      otherDefects.map(d => ({ id: d.external_id, title: d.title, description: d.description })),
      existingNames
    );

    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to suggest clusters';
    console.error('[uat] suggest-clusters error:', msg);
    res.status(500).json({ error: msg });
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
    const MAX_REASON_LENGTH = 5000;
    if (!reason?.trim()) {
      return res.status(400).json({ error: 'reason is required' });
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return res.status(400).json({ error: `reason must be at most ${MAX_REASON_LENGTH} characters` });
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

// ─── GET /api/uat/:projectId/compare — side-by-side run comparison (Phase 3B) ─
router.get('/:projectId/compare', (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const { run1, run2 } = req.query as { run1?: string; run2?: string };

    if (!run1 || !run2) return res.status(400).json({ error: 'run1 and run2 query params are required' });

    const fetchAnalysis = (id: string) =>
      db.prepare('SELECT id, version_name, created_at, defect_count FROM uat_analyses WHERE id = ? AND project_id = ? AND status = ?')
        .get(id, projectId, 'done') as { id: string; version_name: string; created_at: string; defect_count: number } | undefined;

    const a1 = fetchAnalysis(run1);
    const a2 = fetchAnalysis(run2);
    if (!a1 || !a2) return res.status(404).json({ error: 'One or both analyses not found or not completed' });

    const clusterQuery = `
      SELECT
        ca.cluster_key,
        ca.cluster_name,
        COUNT(*)  AS defect_count,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Critical' THEN 4
                 WHEN COALESCE(ro.overridden_priority, d.priority) = 'High'     THEN 2
                 WHEN COALESCE(ro.overridden_priority, d.priority) = 'Medium'   THEN 1
                 ELSE 0 END) AS risk_score,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Critical' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'High'     THEN 1 ELSE 0 END) AS high,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Medium'   THEN 1 ELSE 0 END) AS medium,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Low'      THEN 1 ELSE 0 END) AS low
      FROM cluster_assignments ca
      JOIN defects d ON d.id = ca.defect_id
      LEFT JOIN risk_overrides ro ON ro.defect_id = d.id
      WHERE ca.uat_analysis_id = ?
      GROUP BY ca.cluster_key, ca.cluster_name
      ORDER BY risk_score DESC
    `;

    const priorityQuery = `
      SELECT COALESCE(ro.overridden_priority, d.priority) AS priority, COUNT(*) AS count
      FROM cluster_assignments ca
      JOIN defects d ON d.id = ca.defect_id
      LEFT JOIN risk_overrides ro ON ro.defect_id = d.id
      WHERE ca.uat_analysis_id = ?
      GROUP BY priority
    `;

    type ClusterRow = { cluster_key: string; cluster_name: string; defect_count: number; risk_score: number; critical: number; high: number; medium: number; low: number };
    type PriorityRow = { priority: string; count: number };

    const clusters1 = db.prepare(clusterQuery).all(run1) as ClusterRow[];
    const clusters2 = db.prepare(clusterQuery).all(run2) as ClusterRow[];
    const priority1 = db.prepare(priorityQuery).all(run1) as PriorityRow[];
    const priority2 = db.prepare(priorityQuery).all(run2) as PriorityRow[];

    const toPriorityMap = (rows: PriorityRow[]) =>
      Object.fromEntries(rows.map(r => [r.priority, r.count]));

    const allClusterKeys = [...new Set([...clusters1.map(c => c.cluster_key), ...clusters2.map(c => c.cluster_key)])];
    const clusterDeltas = allClusterKeys.map(key => {
      const c1 = clusters1.find(c => c.cluster_key === key);
      const c2 = clusters2.find(c => c.cluster_key === key);
      return {
        clusterKey: key,
        clusterName: c1?.cluster_name ?? c2?.cluster_name ?? key,
        run1Count: c1?.defect_count ?? 0,
        run2Count: c2?.defect_count ?? 0,
        delta: (c2?.defect_count ?? 0) - (c1?.defect_count ?? 0),
        run1RiskScore: c1?.risk_score ?? 0,
        run2RiskScore: c2?.risk_score ?? 0,
        riskDelta: (c2?.risk_score ?? 0) - (c1?.risk_score ?? 0),
        run1Critical: c1?.critical ?? 0, run1High: c1?.high ?? 0,
        run2Critical: c2?.critical ?? 0, run2High: c2?.high ?? 0,
      };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const pm1 = toPriorityMap(priority1);
    const pm2 = toPriorityMap(priority2);
    const priorityKeys = ['Critical', 'High', 'Medium', 'Low'];
    const priorityDeltas = Object.fromEntries(priorityKeys.map(p => [p, (pm2[p] ?? 0) - (pm1[p] ?? 0)]));

    res.json({
      run1: { id: a1.id, versionName: a1.version_name, date: a1.created_at, defectCount: a1.defect_count, byPriority: pm1, clusters: clusters1 },
      run2: { id: a2.id, versionName: a2.version_name, date: a2.created_at, defectCount: a2.defect_count, byPriority: pm2, clusters: clusters2 },
      delta: { defectCount: a2.defect_count - a1.defect_count, byPriority: priorityDeltas, clusterDeltas },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Comparison failed';
    console.error('[uat] compare error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/uat/:projectId/:analysisId/ai-chat — AI Defect Copilot ────────
router.post('/:projectId/:analysisId/ai-chat', async (req: Request, res: Response) => {
  try {
    const { projectId, analysisId } = req.params as { projectId: string; analysisId: string };
    const { message, history = [] } = req.body as {
      message: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    const analysis = db.prepare(
      'SELECT id, version_name, created_at, defect_count, result_json FROM uat_analyses WHERE id = ? AND project_id = ? AND status = ?'
    ).get(analysisId, projectId, 'done') as {
      id: string; version_name: string; created_at: string;
      defect_count: number; result_json: string | null;
    } | undefined;
    if (!analysis) return res.status(404).json({ error: 'Analysis not found or not completed' });

    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined;

    // ── Build context from DB (clusters + priority breakdown) ─────────────────
    type ClusterCtx = { cluster_name: string; defect_count: number; risk_score: number; critical: number; high: number; medium: number; low: number };
    const clusters = db.prepare(`
      SELECT
        ca.cluster_name,
        COUNT(*) AS defect_count,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Critical' THEN 4
                 WHEN COALESCE(ro.overridden_priority, d.priority) = 'High'     THEN 2
                 WHEN COALESCE(ro.overridden_priority, d.priority) = 'Medium'   THEN 1
                 ELSE 0 END) AS risk_score,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Critical' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'High'     THEN 1 ELSE 0 END) AS high,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Medium'   THEN 1 ELSE 0 END) AS medium,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Low'      THEN 1 ELSE 0 END) AS low
      FROM cluster_assignments ca
      JOIN defects d ON d.id = ca.defect_id
      LEFT JOIN risk_overrides ro ON ro.defect_id = d.id
      WHERE ca.uat_analysis_id = ?
      GROUP BY ca.cluster_key, ca.cluster_name
      ORDER BY risk_score DESC
    `).all(analysisId) as ClusterCtx[];

    type AppCtx = { application: string; total: number; critical: number };
    const apps = db.prepare(`
      SELECT
        d.application,
        COUNT(*) AS total,
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Critical' THEN 1 ELSE 0 END) AS critical
      FROM cluster_assignments ca
      JOIN defects d ON d.id = ca.defect_id
      LEFT JOIN risk_overrides ro ON ro.defect_id = d.id
      WHERE ca.uat_analysis_id = ?
      GROUP BY d.application
      ORDER BY total DESC
      LIMIT 10
    `).all(analysisId) as AppCtx[];

    type TopDefect = { title: string; priority: string; application: string };
    const topDefects = db.prepare(`
      SELECT d.title, COALESCE(ro.overridden_priority, d.priority) AS priority, d.application
      FROM cluster_assignments ca
      JOIN defects d ON d.id = ca.defect_id
      LEFT JOIN risk_overrides ro ON ro.defect_id = d.id
      WHERE ca.uat_analysis_id = ?
        AND COALESCE(ro.overridden_priority, d.priority) IN ('Critical', 'High')
      ORDER BY CASE COALESCE(ro.overridden_priority, d.priority)
               WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 ELSE 2 END
      LIMIT 15
    `).all(analysisId) as TopDefect[];

    // ── Extract executive summary from result JSON ─────────────────────────────
    let executiveSummary = '';
    if (analysis.result_json) {
      try {
        const parsed = JSON.parse(analysis.result_json) as { executiveSummary?: string };
        executiveSummary = parsed.executiveSummary ?? '';
      } catch { /* ignore */ }
    }

    // ── Build system prompt ────────────────────────────────────────────────────
    const clusterLines = clusters.map(c =>
      `  - ${c.cluster_name}: ${c.defect_count} defects (Critical=${c.critical}, High=${c.high}, Medium=${c.medium}, Low=${c.low}, RiskScore=${c.risk_score})`
    ).join('\n');

    const appLines = apps.map(a =>
      `  - ${a.application}: ${a.total} total, ${a.critical} critical`
    ).join('\n');

    const topDefectLines = topDefects.map(d =>
      `  - [${d.priority}] ${d.title} (${d.application})`
    ).join('\n');

    const systemPrompt = `You are an expert UAT Defect Intelligence assistant for the project "${project?.name ?? projectId}".

You are analysing run "${analysis.version_name}" (${new Date(analysis.created_at).toLocaleDateString('it-IT')}) with ${analysis.defect_count} total defects.

## Defect Clusters (ordered by risk score)
${clusterLines || '  (no clusters)'}

## Applications (top by defect count)
${appLines || '  (no application data)'}

## Critical & High Priority Defects (top 15)
${topDefectLines || '  (none)'}

${executiveSummary ? `## Pipeline Executive Summary\n${executiveSummary}` : ''}

## Your role
- Answer analyst questions about this specific run's defect data.
- Provide actionable, concise insights grounded in the data above.
- When asked for sprint priorities or recommendations, reference the actual clusters and applications.
- Keep responses focused and structured (use bullet points for lists).
- Reply in the same language as the user's message (Italian if Italian, English if English).
- Do NOT invent data — if something is not in the context above, say so.`;

    const { callClaudeChat } = await import('../services/claude');
    const response = await callClaudeChat(systemPrompt, [
      ...history,
      { role: 'user', content: message },
    ]);

    res.json({ response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI chat failed';
    console.error('[uat] ai-chat error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ─── GET /api/uat/:projectId/:analysisId — get one (AFTER all specific routes) ─
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

// ─── GET /api/uat/:projectId/:analysisId/export/defects.xlsx ─────────────────
router.get('/:projectId/:analysisId/export/defects.xlsx', (req: Request, res: Response) => {
  try {
    const { projectId, analysisId } = req.params as { projectId: string; analysisId: string };

    const analysis = db.prepare(
      'SELECT id, version_name, created_at, defect_count FROM uat_analyses WHERE id = ? AND project_id = ?'
    ).get(analysisId, projectId) as { id: string; version_name: string; created_at: string; defect_count: number } | undefined;
    if (!analysis) return res.status(404).json({ error: 'UAT analysis not found' });

    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined;

    // ── Sheet 1: Defects ──────────────────────────────────────────────────────
    const defectRows = db.prepare(`
      SELECT
        d.external_id        AS "Work Item ID",
        d.title              AS "Summary",
        COALESCE(ro.overridden_priority, d.priority) AS "Effective Priority",
        d.priority           AS "Original Priority",
        CASE WHEN ro.id IS NOT NULL THEN 'Yes' ELSE 'No' END AS "Priority Overridden",
        ro.reason            AS "Override Reason",
        ca.cluster_name      AS "Cluster",
        ca.method            AS "Classification Method",
        ca.matched_keywords  AS "Matched Keywords",
        d.application        AS "Application",
        d.module             AS "Module",
        d.status             AS "Status",
        d.priority           AS "Severity",
        d.environment        AS "Environment",
        d.detected_by        AS "Detected By",
        d.assigned_to        AS "Assigned To",
        d.detected_date      AS "Detected Date",
        d.closed_date        AS "Closed Date",
        d.description        AS "Description",
        d.resolution         AS "Resolution / Comments"
      FROM cluster_assignments ca
      JOIN defects d ON d.id = ca.defect_id
      LEFT JOIN risk_overrides ro ON ro.defect_id = d.id
      WHERE ca.uat_analysis_id = ?
      ORDER BY
        CASE COALESCE(ro.overridden_priority, d.priority)
          WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 WHEN 'Low' THEN 4 ELSE 5
        END, ca.cluster_name, d.title
    `).all(analysisId) as Record<string, string | null>[];

    // ── Sheet 2: Cluster Summary ──────────────────────────────────────────────
    const clusterRows = db.prepare(`
      SELECT
        ca.cluster_name      AS "Cluster",
        COUNT(*)             AS "Total Defects",
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Critical' THEN 1 ELSE 0 END) AS "Critical",
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'High'     THEN 1 ELSE 0 END) AS "High",
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Medium'   THEN 1 ELSE 0 END) AS "Medium",
        SUM(CASE WHEN COALESCE(ro.overridden_priority, d.priority) = 'Low'      THEN 1 ELSE 0 END) AS "Low",
        SUM(CASE WHEN ro.id IS NOT NULL THEN 1 ELSE 0 END) AS "Overridden Priorities"
      FROM cluster_assignments ca
      JOIN defects d ON d.id = ca.defect_id
      LEFT JOIN risk_overrides ro ON ro.defect_id = d.id
      WHERE ca.uat_analysis_id = ?
      GROUP BY ca.cluster_key, ca.cluster_name
      ORDER BY "Critical" DESC, "High" DESC
    `).all(analysisId) as Record<string, string | number>[];

    // ── Build workbook ────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    const wsDefects = XLSX.utils.json_to_sheet(
      defectRows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? ''])))
    );
    // Auto-width columns
    const defectColWidths = Object.keys(defectRows[0] ?? {}).map(k => ({
      wch: Math.max(k.length, 14),
    }));
    wsDefects['!cols'] = defectColWidths;
    XLSX.utils.book_append_sheet(wb, wsDefects, 'Defects');

    const wsClusters = XLSX.utils.json_to_sheet(clusterRows);
    wsClusters['!cols'] = Object.keys(clusterRows[0] ?? {}).map(k => ({ wch: Math.max(k.length, 12) }));
    XLSX.utils.book_append_sheet(wb, wsClusters, 'Cluster Summary');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const safeName = (project?.name ?? 'project').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const safeVersion = analysis.version_name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const fileName = `${safeName}-${safeVersion}-defects.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Export failed';
    console.error('[uat] Excel export error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/uat/:projectId/run — upload ALM file + trigger analysis ────────
router.post('/:projectId/run', tmpUpload.array('files', 20), async (req: Request, res: Response) => {
  const projectId = req.params.projectId as string;
  const uploadedFiles = (req.files ?? []) as Express.Multer.File[];

  try {
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined;
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (uploadedFiles.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    // ── Parse every file and collect defects with provenance ─────────────────
    type FileParseResult = { file: Express.Multer.File; defects: import('../services/almParser').Defect[]; detectedColumns: string[] };
    const parseResults: FileParseResult[] = [];
    const parseErrors: string[] = [];

    for (const file of uploadedFiles) {
      try {
        const buf = fs.readFileSync(file.path);
        const parsed = parseALMExcel(buf);
        parseResults.push({ file, defects: parsed.defects, detectedColumns: parsed.detectedColumns });
      } catch (e) {
        parseErrors.push(`${file.originalname}: ${e instanceof Error ? e.message : 'parse error'}`);
      }
    }

    if (parseResults.length === 0) {
      return res.status(400).json({ error: `Could not parse any uploaded file. ${parseErrors.join('; ')}` });
    }

    // ── Merge defects; deduplicate by external_id (first file wins) ──────────
    const seenIds = new Set<string>();
    // Track which ingestion_run_id to use for each defect
    type DefectWithRun = { defect: import('../services/almParser').Defect; ingestionRunId: string };
    const mergedDefectsWithRun: DefectWithRun[] = [];

    // First, create all ingestion_run records so we can assign defects to them
    const ingestionRunIds: string[] = [];
    for (const pr of parseResults) {
      const runId = uuidv4();
      ingestionRunIds.push(runId);
      for (const d of pr.defects) {
        if (!seenIds.has(d.id)) {
          seenIds.add(d.id);
          mergedDefectsWithRun.push({ defect: d, ingestionRunId: runId });
        }
      }
    }

    const totalDefects = mergedDefectsWithRun.length;

    if (totalDefects === 0) {
      return res.status(400).json({
        error: 'No defects found across all uploaded files. Please verify they are valid ALM exports.',
      });
    }

    // ── Build summary labels ──────────────────────────────────────────────────
    const fileNames = parseResults.map(pr => pr.file.originalname);
    const fileNameSummary = fileNames.length === 1
      ? fileNames[0]
      : `${fileNames[0]} +${fileNames.length - 1} more`;
    const allDetectedColumns = [...new Set(parseResults.flatMap(pr => pr.detectedColumns))];

    // ── Create analysis record ────────────────────────────────────────────────
    const count = (db.prepare('SELECT COUNT(*) as c FROM uat_analyses WHERE project_id = ?').get(projectId) as { c: number }).c;
    const versionName = `UAT Analysis v${count + 1}`;
    const analysisId = uuidv4();

    db.prepare(`
      INSERT INTO uat_analyses (id, project_id, version_name, status, file_name, defect_count)
      VALUES (?, ?, ?, 'running', ?, ?)
    `).run(analysisId, projectId, versionName, fileNameSummary, totalDefects);

    // ── Persist ingestion_run + defects in one transaction ───────────────────
    const insertRun = db.prepare(`
      INSERT INTO ingestion_runs (id, project_id, uat_analysis_id, file_name, defect_count)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertDefect = db.prepare(`
      INSERT INTO defects
        (id, external_id, project_id, ingestion_run_id, title, priority, status, application, module, description, resolution, detected_by, assigned_to, detected_date, closed_date, environment)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (let i = 0; i < parseResults.length; i++) {
        const pr = parseResults[i];
        const runId = ingestionRunIds[i];
        const defectsForRun = mergedDefectsWithRun.filter(x => x.ingestionRunId === runId);
        insertRun.run(runId, projectId, analysisId, pr.file.originalname, defectsForRun.length);
      }
      for (const { defect: d, ingestionRunId } of mergedDefectsWithRun) {
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
    })();

    // Load previous run for delta context
    const prevAnalysis = db.prepare(
      "SELECT result_json FROM uat_analyses WHERE project_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1"
    ).get(projectId) as { result_json: string | null } | undefined;

    res.status(202).json({
      analysisId,
      versionName,
      status: 'running',
      defectCount: totalDefects,
      fileCount: parseResults.length,
      detectedColumns: allDetectedColumns,
      ...(parseErrors.length > 0 && { warnings: parseErrors }),
    });

    // Use first ingestion run id for the async runner (cosmetic, run label only)
    runUATAsync(analysisId, projectId, project.name, mergedDefectsWithRun.map(x => x.defect), fileNameSummary, ingestionRunIds[0], prevAnalysis?.result_json ?? null)
      .catch(err => {
        console.error('[uat] Async error:', err);
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        db.prepare(`UPDATE uat_analyses SET status = 'error', error_message = ? WHERE id = ?`).run(errMsg, analysisId);
      });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start UAT analysis';
    res.status(500).json({ error: msg });
  } finally {
    for (const file of uploadedFiles) {
      if (file.path && fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch (_) {}
      }
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
