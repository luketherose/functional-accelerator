import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../db';
import { buildAnalysisPrompt, buildImpactPrototypePrompt } from '../services/promptBuilder';
import { callClaude, callClaudeForHtml } from '../services/claude';
import { readImageAsBase64 } from '../services/fileParsing';
import { renderHtmlToPng } from '../services/imageRenderer';
import type { ProjectFile } from '../types';

const router = Router();

// Temporary upload for impact prototype images (deleted after use)
const tmpUpload = multer({
  dest: path.resolve('./tmp-uploads'),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are accepted'));
  },
});

// GET /api/analysis/:projectId — list analyses for a project
router.get('/:projectId', (req: Request, res: Response) => {
  try {
    const analyses = db.prepare('SELECT * FROM analyses WHERE project_id = ? ORDER BY created_at DESC').all(req.params.projectId);
    res.json(analyses);
  } catch {
    res.status(500).json({ error: 'Failed to fetch analyses' });
  }
});

// GET /api/analysis/:projectId/:analysisId/impact-prototype/:impactId
router.get('/:projectId/:analysisId/impact-prototype/:impactId', (req: Request, res: Response) => {
  try {
    const proto = db.prepare(
      'SELECT id, analysis_id, impact_id, image_data, created_at FROM impact_prototypes WHERE analysis_id = ? AND impact_id = ?'
    ).get(req.params.analysisId, req.params.impactId);
    if (!proto) return res.status(404).json({ error: 'No prototype found for this impact' });
    res.json(proto);
  } catch {
    res.status(500).json({ error: 'Failed to fetch impact prototype' });
  }
});

// GET /api/analysis/:projectId/:analysisId — get a specific analysis
router.get('/:projectId/:analysisId', (req: Request, res: Response) => {
  try {
    const analysis = db.prepare('SELECT * FROM analyses WHERE id = ? AND project_id = ?').get(req.params.analysisId, req.params.projectId);
    if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
    res.json(analysis);
  } catch {
    res.status(500).json({ error: 'Failed to fetch analysis' });
  }
});

// POST /api/analysis/:projectId/run — trigger a new analysis
router.post('/:projectId/run', async (req: Request, res: Response) => {
  const projectId = req.params.projectId as string;

  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as { name: string; description: string } | undefined;
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const files = db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as ProjectFile[];

    if (files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded. Please upload at least one document before analyzing.' });
    }

    const count = (db.prepare('SELECT COUNT(*) as c FROM analyses WHERE project_id = ?').get(projectId) as { c: number }).c;
    const versionName = `Analysis v${count + 1}`;
    const analysisId = uuidv4();

    db.prepare(`INSERT INTO analyses (id, project_id, version_name, status) VALUES (?, ?, ?, 'running')`).run(analysisId, projectId, versionName);
    db.prepare(`UPDATE projects SET status = 'analyzing', updated_at = datetime('now') WHERE id = ?`).run(projectId);

    res.status(202).json({ analysisId, versionName, status: 'running' });

    runAnalysisAsync(analysisId, projectId, project, files).catch((err) => {
      console.error('[analysis] Async error:', err);
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start analysis';
    res.status(500).json({ error: msg });
  }
});

// POST /api/analysis/:projectId/:analysisId/impact-prototype
router.post('/:projectId/:analysisId/impact-prototype', tmpUpload.single('file'), async (req: Request, res: Response) => {
  const { analysisId, projectId } = req.params as { analysisId: string; projectId: string };
  const tmpFilePath = req.file?.path;

  try {
    const analysis = db.prepare('SELECT * FROM analyses WHERE id = ? AND project_id = ?').get(analysisId, projectId) as { id: string } | undefined;
    if (!analysis) return res.status(404).json({ error: 'Analysis not found' });

    if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });

    const { impactId, impactArea, impactDescription } = req.body as {
      impactId: string;
      impactArea: string;
      impactDescription: string;
    };
    if (!impactId || !impactArea || !impactDescription) {
      return res.status(400).json({ error: 'impactId, impactArea, and impactDescription are required' });
    }

    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined;
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { data, mediaType } = readImageAsBase64(req.file.path, req.file.mimetype);
    const imageBlock = { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data } };

    const prompt = buildImpactPrototypePrompt({ area: impactArea, description: impactDescription }, project.name);
    console.log(`[analysis] Generating HTML prototype for impact ${impactId}...`);
    const html = await callClaudeForHtml(prompt, imageBlock);

    console.log(`[analysis] Rendering HTML to PNG for impact ${impactId}...`);
    const imageData = await renderHtmlToPng(html);

    // Upsert into impact_prototypes
    const existing = db.prepare('SELECT id FROM impact_prototypes WHERE analysis_id = ? AND impact_id = ?').get(analysisId, impactId) as { id: string } | undefined;
    if (existing) {
      db.prepare("UPDATE impact_prototypes SET image_data = ?, created_at = datetime('now') WHERE id = ?").run(imageData, existing.id);
    } else {
      const protoId = uuidv4();
      db.prepare('INSERT INTO impact_prototypes (id, analysis_id, impact_id, image_data) VALUES (?, ?, ?, ?)').run(protoId, analysisId, impactId, imageData);
    }

    const saved = db.prepare('SELECT id, analysis_id, impact_id, image_data, created_at FROM impact_prototypes WHERE analysis_id = ? AND impact_id = ?').get(analysisId, impactId);
    res.json(saved);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to generate prototype';
    console.error('[analysis] Impact prototype error:', msg);
    res.status(500).json({ error: msg });
  } finally {
    if (tmpFilePath && fs.existsSync(tmpFilePath)) {
      try { fs.unlinkSync(tmpFilePath); } catch (_) {}
    }
  }
});

async function runAnalysisAsync(
  analysisId: string,
  projectId: string,
  project: { name: string; description: string },
  files: ProjectFile[]
) {
  try {
    const prompt = await buildAnalysisPrompt(project, files);
    const inputSummary = `Project: ${project.name} | Files: ${files.length} (${files.filter(f => f.bucket === 'as-is').length} as-is, ${files.filter(f => f.bucket === 'to-be').length} to-be)`;

    console.log(`[analysis] Running ${analysisId} — ${inputSummary}`);

    const resultJson = await callClaude(prompt);

    db.prepare(`UPDATE analyses SET status = 'done', input_summary = ?, result_json = ? WHERE id = ?`).run(inputSummary, JSON.stringify(resultJson), analysisId);
    db.prepare(`UPDATE projects SET status = 'done', updated_at = datetime('now') WHERE id = ?`).run(projectId);
    console.log(`[analysis] Completed ${analysisId}`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Analysis failed';
    console.error(`[analysis] Failed ${analysisId}:`, msg);

    db.prepare(`UPDATE analyses SET status = 'error', error_message = ? WHERE id = ?`).run(msg, analysisId);
    db.prepare(`UPDATE projects SET status = 'error', updated_at = datetime('now') WHERE id = ?`).run(projectId);
  }
}

// DELETE /api/analysis/:projectId/:analysisId
router.delete('/:projectId/:analysisId', (req: Request, res: Response) => {
  try {
    const analysis = db.prepare('SELECT id FROM analyses WHERE id = ? AND project_id = ?').get(req.params.analysisId, req.params.projectId);
    if (!analysis) return res.status(404).json({ error: 'Analysis not found' });

    db.prepare('DELETE FROM analyses WHERE id = ?').run(req.params.analysisId);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete analysis' });
  }
});

export default router;
