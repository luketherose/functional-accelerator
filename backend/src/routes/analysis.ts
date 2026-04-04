import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { buildAnalysisPrompt } from '../services/promptBuilder';
import { callClaude } from '../services/claude';
import { ProjectFile } from '../types';
import fs from 'fs';

const router = Router();

// GET /api/analysis/:projectId — list analyses for a project
router.get('/:projectId', (req: Request, res: Response) => {
  try {
    const analyses = db.prepare('SELECT * FROM analyses WHERE project_id = ? ORDER BY created_at DESC').all(req.params.projectId);
    res.json(analyses);
  } catch {
    res.status(500).json({ error: 'Failed to fetch analyses' });
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

    // Count analyses to generate version name
    const count = (db.prepare('SELECT COUNT(*) as c FROM analyses WHERE project_id = ?').get(projectId) as { c: number }).c;
    const versionName = `Analysis v${count + 1}`;
    const analysisId = uuidv4();

    // Create analysis record as pending
    db.prepare(`
      INSERT INTO analyses (id, project_id, version_name, status)
      VALUES (?, ?, ?, 'running')
    `).run(analysisId, projectId, versionName);

    // Mark project as analyzing
    db.prepare(`UPDATE projects SET status = 'analyzing', updated_at = datetime('now') WHERE id = ?`).run(projectId);

    // Return immediately with the analysis ID so frontend can poll
    res.status(202).json({ analysisId, versionName, status: 'running' });

    // Run analysis asynchronously
    runAnalysisAsync(analysisId, projectId, project, files).catch((err) => {
      console.error('[analysis] Async error:', err);
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start analysis';
    res.status(500).json({ error: msg });
  }
});

async function runAnalysisAsync(
  analysisId: string,
  projectId: string,
  project: { name: string; description: string },
  files: ProjectFile[]
) {
  try {
    // Build prompt and messages
    const { prompt, imageBlocks } = await buildAnalysisPrompt(project, files);

    // Summarize input for logging
    const inputSummary = `Project: ${project.name} | Files: ${files.length} (${files.filter(f => f.bucket === 'as-is').length} as-is, ${files.filter(f => f.bucket === 'to-be').length} to-be, ${files.filter(f => f.bucket === 'screenshot').length} screenshots)`;

    console.log(`[analysis] Running ${analysisId} — ${inputSummary}`);

    // Call Claude
    const resultJson = await callClaude(prompt, imageBlocks);

    // Save result
    db.prepare(`
      UPDATE analyses SET status = 'done', input_summary = ?, result_json = ? WHERE id = ?
    `).run(inputSummary, JSON.stringify(resultJson), analysisId);

    db.prepare(`UPDATE projects SET status = 'done', updated_at = datetime('now') WHERE id = ?`).run(projectId);
    console.log(`[analysis] Completed ${analysisId}`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Analysis failed';
    console.error(`[analysis] Failed ${analysisId}:`, msg);

    db.prepare(`
      UPDATE analyses SET status = 'error', error_message = ? WHERE id = ?
    `).run(msg, analysisId);

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
