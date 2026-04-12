import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../db';
import { buildImpactPrototypePrompt, buildDeepDiveSystemPrompt } from '../services/promptBuilder';
import { callClaudeForHtml, callClaudeChat } from '../services/claude';
import { runAnalysisPipeline } from '../services/pipeline';
import { readImageAsBase64 } from '../services/fileParsing';
import { renderHtmlToPng } from '../services/imageRenderer';
import { multiQuerySearch, formatRetrievedChunks, hasIndexedChunks } from '../services/vectorStore';
import type { ProjectFile } from '../types';

interface ImpactFeedbackRow {
  id: string;
  analysis_id: string;
  impact_id: string;
  sentiment: 'positive' | 'negative';
  motivation: string | null;
  created_at: string;
}

interface OQFeedbackRow {
  id: string;
  analysis_id: string;
  question_text: string;
  sentiment: 'positive' | 'negative' | null;
  answer: string | null;
  created_at: string;
}

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

    // Load feedback + OQ answers from the most recent completed analysis for this project
    const prevAnalysis = db.prepare(
      "SELECT id FROM analyses WHERE project_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1"
    ).get(projectId) as { id: string } | undefined;
    const prevFeedback = prevAnalysis
      ? (db.prepare('SELECT * FROM impact_feedback WHERE analysis_id = ?').all(prevAnalysis.id) as ImpactFeedbackRow[])
      : [];
    const prevOQFeedback = prevAnalysis
      ? (db.prepare('SELECT * FROM open_question_feedback WHERE analysis_id = ?').all(prevAnalysis.id) as OQFeedbackRow[])
      : [];

    res.status(202).json({ analysisId, versionName, status: 'running' });

    runAnalysisAsync(analysisId, projectId, project, files, prevFeedback, prevOQFeedback).catch((err) => {
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

    const { impactId, impactArea, impactDescription, userPrompt } = req.body as {
      impactId: string;
      impactArea: string;
      impactDescription: string;
      userPrompt?: string;
    };
    if (!impactId || !impactArea || !impactDescription) {
      return res.status(400).json({ error: 'impactId, impactArea, and impactDescription are required' });
    }

    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined;
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { data, mediaType } = readImageAsBase64(req.file.path, req.file.mimetype);
    const imageBlock = { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data } };

    const prompt = buildImpactPrototypePrompt({ area: impactArea, description: impactDescription }, project.name, userPrompt);
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
    if (tmpFilePath) {
      try { fs.unlinkSync(tmpFilePath); } catch (_) {}
    }
  }
});

async function runAnalysisAsync(
  analysisId: string,
  projectId: string,
  project: { name: string; description: string },
  files: ProjectFile[],
  prevFeedback: ImpactFeedbackRow[] = [],
  prevOQFeedback: OQFeedbackRow[] = []
) {
  const brCount = files.filter(f => f.bucket === 'business-rules').length;
  const inputSummary = `Project: ${project.name} | Files: ${files.length} (${files.filter(f => f.bucket === 'as-is').length} as-is, ${files.filter(f => f.bucket === 'to-be').length} to-be${brCount > 0 ? `, ${brCount} BR` : ''})`;

  const setProgress = (step: string) => {
    db.prepare("UPDATE analyses SET progress_step = ? WHERE id = ?").run(step, analysisId);
  };

  try {
    console.log(`[analysis] Running pipeline ${analysisId} — ${inputSummary}`);

    const resultJson = await runAnalysisPipeline(project, files, {
      onProgress: setProgress,
      projectId,
      prevFeedback: prevFeedback.map(f => ({
        impact_id: f.impact_id,
        sentiment: f.sentiment,
        motivation: f.motivation,
      })),
      prevOQAnswers: prevOQFeedback.map(q => ({
        question_text: q.question_text,
        sentiment: q.sentiment,
        answer: q.answer,
      })),
    });

    db.prepare(
      "UPDATE analyses SET status = 'done', input_summary = ?, result_json = ?, progress_step = NULL WHERE id = ?"
    ).run(inputSummary, JSON.stringify(resultJson), analysisId);
    db.prepare(`UPDATE projects SET status = 'done', updated_at = datetime('now') WHERE id = ?`).run(projectId);
    console.log(`[analysis] Completed ${analysisId}`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Analysis failed';
    console.error(`[analysis] Failed ${analysisId}:`, msg);

    db.prepare("UPDATE analyses SET status = 'error', error_message = ?, progress_step = NULL WHERE id = ?").run(msg, analysisId);
    db.prepare(`UPDATE projects SET status = 'error', updated_at = datetime('now') WHERE id = ?`).run(projectId);
  }
}

// GET /api/analysis/:projectId/:analysisId/feedback
router.get('/:projectId/:analysisId/feedback', (req: Request, res: Response) => {
  try {
    const analysis = db.prepare('SELECT id FROM analyses WHERE id = ? AND project_id = ?').get(req.params.analysisId, req.params.projectId);
    if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
    const rows = db.prepare('SELECT * FROM impact_feedback WHERE analysis_id = ?').all(req.params.analysisId);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

// POST /api/analysis/:projectId/:analysisId/feedback — upsert one impact's feedback
router.post('/:projectId/:analysisId/feedback', async (req: Request, res: Response) => {
  const { impactId, sentiment, motivation } = req.body as {
    impactId: string;
    sentiment: 'positive' | 'negative';
    motivation?: string;
  };
  if (!impactId || !['positive', 'negative'].includes(sentiment)) {
    return res.status(400).json({ error: 'impactId and sentiment (positive|negative) are required' });
  }
  try {
    const existing = db.prepare('SELECT id FROM impact_feedback WHERE analysis_id = ? AND impact_id = ?')
      .get(req.params.analysisId, impactId) as { id: string } | undefined;
    if (existing) {
      db.prepare('UPDATE impact_feedback SET sentiment = ?, motivation = ? WHERE id = ?')
        .run(sentiment, motivation ?? null, existing.id);
    } else {
      db.prepare('INSERT INTO impact_feedback (id, analysis_id, impact_id, sentiment, motivation) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), req.params.analysisId, impactId, sentiment, motivation ?? null);
    }
    const row = db.prepare('SELECT * FROM impact_feedback WHERE analysis_id = ? AND impact_id = ?')
      .get(req.params.analysisId, impactId);
    res.json(row);
  } catch {
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// DELETE /api/analysis/:projectId/:analysisId/feedback/:impactId — remove feedback for one impact
router.delete('/:projectId/:analysisId/feedback/:impactId', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM impact_feedback WHERE analysis_id = ? AND impact_id = ?')
      .run(req.params.analysisId, req.params.impactId);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
});

// POST /api/analysis/:projectId/:analysisId/impact-deepdive
router.post('/:projectId/:analysisId/impact-deepdive', async (req: Request, res: Response) => {
  const { analysisId, projectId } = req.params as { analysisId: string; projectId: string };
  const { impactArea, impactDescription, messages } = req.body as {
    impactArea: string;
    impactDescription: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!impactArea || !impactDescription || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'impactArea, impactDescription, and messages are required' });
  }

  try {
    const analysis = db.prepare('SELECT id FROM analyses WHERE id = ? AND project_id = ?').get(analysisId, projectId);
    if (!analysis) return res.status(404).json({ error: 'Analysis not found' });

    const project = db.prepare('SELECT name, description FROM projects WHERE id = ?').get(projectId) as { name: string; description: string } | undefined;
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const queries = [impactArea, impactDescription];
    let systemPrompt: string;

    if (hasIndexedChunks(projectId)) {
      // RAG mode: retrieve impact-focused chunks from both buckets in parallel
      console.log(`[analysis] Deep dive RAG retrieval for impact "${impactArea}" in project ${projectId}`);
      const [asisChunks, tobeChunks, brChunks] = await Promise.all([
        multiQuerySearch(projectId, 'as-is', queries, 20),
        multiQuerySearch(projectId, 'to-be', queries, 20),
        multiQuerySearch(projectId, 'business-rules', queries, 10),
      ]);

      const retrievedContext = {
        asis: formatRetrievedChunks(asisChunks, 'AS-IS Passages', 40_000),
        tobe: formatRetrievedChunks(tobeChunks, 'TO-BE Passages', 40_000),
        br: brChunks.length > 0 ? formatRetrievedChunks(brChunks, 'Business Rules Passages', 20_000) : '',
      };
      systemPrompt = buildDeepDiveSystemPrompt(project, { area: impactArea, description: impactDescription }, retrievedContext);
    } else {
      // Fallback: pass full file texts (no indexed chunks)
      console.log(`[analysis] Deep dive fallback (no RAG) for impact "${impactArea}" in project ${projectId}`);
      const files = db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as ProjectFile[];
      systemPrompt = buildDeepDiveSystemPrompt(project, { area: impactArea, description: impactDescription }, undefined, files);
    }

    console.log(`[analysis] Deep dive for impact "${impactArea}", ${messages.length} messages`);
    const response = await callClaudeChat(systemPrompt, messages);
    res.json({ response });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Deep dive failed';
    console.error('[analysis] Deep dive error:', msg);
    res.status(500).json({ error: msg });
  }
});

// GET /api/analysis/:projectId/:analysisId/open-question-feedback
router.get('/:projectId/:analysisId/open-question-feedback', (req: Request, res: Response) => {
  try {
    const analysis = db.prepare('SELECT id FROM analyses WHERE id = ? AND project_id = ?').get(req.params.analysisId, req.params.projectId);
    if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
    const rows = db.prepare('SELECT * FROM open_question_feedback WHERE analysis_id = ?').all(req.params.analysisId);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch open question feedback' });
  }
});

// POST /api/analysis/:projectId/:analysisId/open-question-feedback — upsert one question's feedback
router.post('/:projectId/:analysisId/open-question-feedback', (req: Request, res: Response) => {
  const { questionText, sentiment, answer } = req.body as {
    questionText: string;
    sentiment?: 'positive' | 'negative' | null;
    answer?: string | null;
  };
  if (!questionText) return res.status(400).json({ error: 'questionText is required' });
  try {
    const existing = db.prepare('SELECT id FROM open_question_feedback WHERE analysis_id = ? AND question_text = ?')
      .get(req.params.analysisId, questionText) as { id: string } | undefined;
    if (existing) {
      db.prepare('UPDATE open_question_feedback SET sentiment = ?, answer = ? WHERE id = ?')
        .run(sentiment ?? null, answer ?? null, existing.id);
    } else {
      db.prepare('INSERT INTO open_question_feedback (id, analysis_id, question_text, sentiment, answer) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), req.params.analysisId, questionText, sentiment ?? null, answer ?? null);
    }
    const row = db.prepare('SELECT * FROM open_question_feedback WHERE analysis_id = ? AND question_text = ?')
      .get(req.params.analysisId, questionText);
    res.json(row);
  } catch {
    res.status(500).json({ error: 'Failed to save open question feedback' });
  }
});

// DELETE /api/analysis/:projectId/:analysisId/open-question-feedback — remove feedback for one question
router.delete('/:projectId/:analysisId/open-question-feedback', (req: Request, res: Response) => {
  const { questionText } = req.body as { questionText: string };
  if (!questionText) return res.status(400).json({ error: 'questionText is required' });
  try {
    db.prepare('DELETE FROM open_question_feedback WHERE analysis_id = ? AND question_text = ?')
      .run(req.params.analysisId, questionText);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete open question feedback' });
  }
});

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
