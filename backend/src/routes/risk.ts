import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { callClaudeJson } from '../services/claude';

const router = Router();

const tmpUpload = multer({
  dest: path.resolve('./tmp-uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'text/plain',
      'application/csv',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) or CSV files are accepted'));
    }
  },
});

// GET /api/risk/:projectId — list assessments
router.get('/:projectId', (req: Request, res: Response) => {
  try {
    const assessments = db
      .prepare('SELECT * FROM risk_assessments WHERE project_id = ? ORDER BY created_at DESC')
      .all(req.params.projectId);
    res.json(assessments);
  } catch {
    res.status(500).json({ error: 'Failed to fetch risk assessments' });
  }
});

// GET /api/risk/:projectId/:assessmentId — get single assessment
router.get('/:projectId/:assessmentId', (req: Request, res: Response) => {
  try {
    const assessment = db
      .prepare('SELECT * FROM risk_assessments WHERE id = ? AND project_id = ?')
      .get(req.params.assessmentId, req.params.projectId);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    res.json(assessment);
  } catch {
    res.status(500).json({ error: 'Failed to fetch risk assessment' });
  }
});

// POST /api/risk/:projectId/run — start async risk assessment
router.post('/:projectId/run', tmpUpload.single('file'), async (req: Request, res: Response) => {
  const projectId = req.params.projectId as string;

  try {
    const project = db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(projectId) as { name: string } | undefined;
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!req.file) return res.status(400).json({ error: 'No defect file uploaded' });

    const { sourceContext, targetContext } = req.body as {
      sourceContext?: string;
      targetContext?: string;
    };

    const src = (sourceContext || '').trim() || project.name;
    const tgt = (targetContext || '').trim() || 'target deployment';

    const count = (
      db.prepare('SELECT COUNT(*) as c FROM risk_assessments WHERE project_id = ?').get(projectId) as { c: number }
    ).c;
    const versionName = `Risk v${count + 1}`;
    const assessmentId = uuidv4();

    db.prepare(
      `INSERT INTO risk_assessments (id, project_id, version_name, status, progress_step) VALUES (?, ?, ?, 'running', ?)`
    ).run(assessmentId, projectId, versionName, 'Parsing defect file…');

    res.status(202).json({ assessmentId, versionName, status: 'running' });

    // Fire-and-forget async
    runRiskAssessmentAsync(assessmentId, projectId, req.file, src, tgt).catch(err => {
      console.error('[risk] Async error:', err);
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start risk assessment';
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/risk/:projectId/:assessmentId
router.delete('/:projectId/:assessmentId', (req: Request, res: Response) => {
  try {
    const assessment = db
      .prepare('SELECT id FROM risk_assessments WHERE id = ? AND project_id = ?')
      .get(req.params.assessmentId, req.params.projectId);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    db.prepare('DELETE FROM risk_assessments WHERE id = ?').run(req.params.assessmentId);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete risk assessment' });
  }
});

// --- Async execution ---

interface DefectRow {
  [key: string]: unknown;
}

async function runRiskAssessmentAsync(
  assessmentId: string,
  _projectId: string,
  file: Express.Multer.File,
  sourceContext: string,
  targetContext: string
): Promise<void> {
  const tmpFilePath = file.path;
  try {
    // Step 1: Parse file
    db.prepare("UPDATE risk_assessments SET progress_step = ? WHERE id = ?")
      .run('Parsing defect file…', assessmentId);

    let rows: DefectRow[] = [];
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === '.csv' || file.mimetype === 'text/csv' || file.mimetype === 'text/plain') {
      const text = fs.readFileSync(tmpFilePath, 'utf-8');
      rows = parseCsvToRows(text);
    } else {
      // Excel
      const XLSX = require('xlsx') as typeof import('xlsx');
      const workbook = XLSX.readFile(tmpFilePath);
      if (!workbook.SheetNames.length) throw new Error('Workbook has no sheets');
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json<DefectRow>(sheet);
    }

    const defectCount = rows.length;
    db.prepare('UPDATE risk_assessments SET defect_count = ? WHERE id = ?').run(defectCount, assessmentId);

    if (defectCount === 0) {
      throw new Error('No defects found in the uploaded file. Please check the file format.');
    }

    // Serialize defects (cap at 200 rows, 30k chars)
    const defectsText = JSON.stringify(rows.slice(0, 200), null, 1).slice(0, 30_000);

    // Step 2: Categorize
    db.prepare("UPDATE risk_assessments SET progress_step = ? WHERE id = ?")
      .run(`Categorizing ${defectCount} defects…`, assessmentId);

    type CategorizationResult = {
      defectCategories: { name: string; count: number; percentage: number }[];
      priorityDistribution: { priority: string; count: number; percentage: number }[];
      topDefects: { title: string; count: number; priority: string; category: string }[];
      patterns: string[];
    };

    const categorization = await callClaudeJson<CategorizationResult>(
      buildCategorizationPrompt(defectsText, sourceContext, defectCount)
    );

    // Step 3: Recommendations
    db.prepare("UPDATE risk_assessments SET progress_step = ? WHERE id = ?")
      .run('Generating risk recommendations…', assessmentId);

    type RecommendationResult = {
      summary: string;
      riskAreas: { area: string; riskLevel: 'high' | 'medium' | 'low'; rationale: string; recommendation: string }[];
      overallRiskLevel: 'high' | 'medium' | 'low';
    };

    const recommendations = await callClaudeJson<RecommendationResult>(
      buildRecommendationPrompt(categorization, sourceContext, targetContext, defectCount)
    );

    const result = { ...categorization, ...recommendations };

    db.prepare(
      "UPDATE risk_assessments SET status = 'done', result_json = ?, progress_step = NULL WHERE id = ?"
    ).run(JSON.stringify(result), assessmentId);

    console.log(`[risk] Completed assessment ${assessmentId} (${defectCount} defects)`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Risk assessment failed';
    console.error(`[risk] Failed ${assessmentId}:`, msg);
    db.prepare(
      "UPDATE risk_assessments SET status = 'error', error_message = ?, progress_step = NULL WHERE id = ?"
    ).run(msg, assessmentId);
  } finally {
    if (fs.existsSync(tmpFilePath)) {
      try { fs.unlinkSync(tmpFilePath); } catch (_) {}
    }
  }
}

function parseCsvToRows(text: string): DefectRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const row: DefectRow = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] || '').trim().replace(/^"|"$/g, '');
    });
    return row;
  });
}

function buildCategorizationPrompt(defectsText: string, sourceContext: string, defectCount: number): string {
  return `You are a senior QA analyst. You have been given ${defectCount} defects exported from an ALM system for "${sourceContext}".

## DEFECTS DATA
${defectsText}

Analyze these defects and produce a structured categorization. Group by functional area, analyze priority/severity distribution, and identify the top recurring issues and patterns.

Return ONLY valid JSON with this exact schema (no prose, no markdown fences):
{
  "defectCategories": [{"name": "string", "count": number, "percentage": number}],
  "priorityDistribution": [{"priority": "string", "count": number, "percentage": number}],
  "topDefects": [{"title": "string", "count": number, "priority": "string", "category": "string"}],
  "patterns": ["string — a key observed pattern or root cause"]
}

Rules:
- defectCategories: group by functional area or defect type, max 10 categories, sorted by count descending
- priorityDistribution: group by the priority/severity field present in the data, sorted by severity descending
- topDefects: the 5-8 most impactful or recurring defects/issue types
- patterns: 4-6 key patterns or root causes observed (what causes most defects, most fragile areas)
- All percentage values within each array must sum to ~100 (round to 1 decimal)`;
}

function buildRecommendationPrompt(
  categorization: object,
  sourceContext: string,
  targetContext: string,
  defectCount: number
): string {
  return `You are a senior QA strategist. Based on a defect analysis from "${sourceContext}" (${defectCount} total defects), generate a risk assessment for the upcoming "${targetContext}" deployment.

## DEFECT ANALYSIS FROM ${sourceContext.toUpperCase()}
${JSON.stringify(categorization, null, 2).slice(0, 8_000)}

Based on what went wrong in "${sourceContext}", identify the highest-risk areas for "${targetContext}" and provide concrete mitigation recommendations.

Return ONLY valid JSON with this exact schema (no prose, no markdown fences):
{
  "summary": "string — 3-4 sentences: overall risk profile for ${targetContext} based on ${sourceContext} history",
  "riskAreas": [
    {
      "area": "string — functional or technical area",
      "riskLevel": "high|medium|low",
      "rationale": "string — why this is risky, referencing ${sourceContext} defect data",
      "recommendation": "string — specific preventive action for ${targetContext}"
    }
  ],
  "overallRiskLevel": "high|medium|low"
}

Produce 5-8 risk areas ordered by riskLevel descending. Be specific and actionable.`;
}

export default router;
