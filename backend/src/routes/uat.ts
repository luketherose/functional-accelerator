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

// Temporary upload storage for ALM Excel files
const tmpUpload = multer({
  dest: path.resolve('./tmp-uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel',                                            // .xls
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

// ─── POST /api/uat/:projectId/run — upload ALM file + trigger analysis ────────
router.post('/:projectId/run', tmpUpload.single('file'), async (req: Request, res: Response) => {
  const projectId = req.params.projectId as string;
  const tmpFilePath = req.file?.path;

  try {
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined;
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Parse the ALM export right away so we can validate it
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

    res.status(202).json({
      analysisId,
      versionName,
      status: 'running',
      defectCount: parsed.defects.length,
      detectedColumns: parsed.detectedColumns,
    });

    // Run async
    runUATAsync(analysisId, projectId, project.name, parsed.defects, req.file.originalname)
      .catch(err => console.error('[uat] Async error:', err));

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start UAT analysis';
    res.status(500).json({ error: msg });
  } finally {
    // Clean up temp file
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
  fileName: string
) {
  const setProgress = (step: string) => {
    db.prepare("UPDATE uat_analyses SET progress_step = ? WHERE id = ?").run(step, analysisId);
  };

  try {
    console.log(`[uat] Running pipeline ${analysisId} — ${defects.length} defects from ${fileName}`);

    const result = await runUATPipeline(defects, projectName, setProgress);

    db.prepare(`
      UPDATE uat_analyses
      SET status = 'done', result_json = ?, defect_count = ?, progress_step = NULL
      WHERE id = ?
    `).run(JSON.stringify(result), result.totalDefects, analysisId);

    db.prepare(`UPDATE projects SET updated_at = datetime('now') WHERE id = ?`).run(projectId);
    console.log(`[uat] Completed ${analysisId}`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'UAT analysis failed';
    console.error(`[uat] Failed ${analysisId}:`, msg);
    db.prepare("UPDATE uat_analyses SET status = 'error', error_message = ?, progress_step = NULL WHERE id = ?")
      .run(msg, analysisId);
  }
}

export default router;
