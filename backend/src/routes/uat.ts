import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../db';
import { parseALMExcel } from '../services/almParser';
import { runUATPipeline } from '../services/uatPipeline';
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
        ca.matched_keywords
      FROM cluster_assignments ca
      JOIN defects d ON d.id = ca.defect_id
      WHERE ca.uat_analysis_id = ?
        AND ca.cluster_key = ?
      ORDER BY
        CASE d.priority
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
