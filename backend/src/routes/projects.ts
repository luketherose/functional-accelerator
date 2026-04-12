import { FileBucket } from '../types';
import db from '../db';
import { parseFile } from '../services/fileParsing';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Router, Request, Response } from 'express';

const UPLOADS_BASE = path.resolve(process.env.UPLOADS_PATH || './uploads');

const router = Router();

// GET /api/projects
router.get('/', (_req: Request, res: Response) => {
  try {
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// GET /api/projects/:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const files = db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id);
    const analyses = db.prepare('SELECT * FROM analyses WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id);

    res.json({ ...project as object, files, analyses });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// POST /api/projects
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    if (!name || name.trim() === '') return res.status(400).json({ error: 'Project name is required' });

    const id = uuidv4();
    db.prepare(`
      INSERT INTO projects (id, name, description, status) VALUES (?, ?, ?, 'draft')
    `).run(id, name.trim(), (description || '').trim());

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// PATCH /api/projects/:id
router.patch('/:id', (req: Request, res: Response) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { name, description, status } = req.body;
    db.prepare(`
      UPDATE projects SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(name || null, description || null, status || null, req.params.id);

    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Delete uploaded files from disk
    const files = db.prepare('SELECT path FROM files WHERE project_id = ?').all(req.params.id) as { path: string }[];
    for (const file of files) {
      try {
        const normalizedPath = path.normalize(file.path);
        if (normalizedPath.startsWith(UPLOADS_BASE)) {
          fs.unlinkSync(normalizedPath);
        }
      } catch (err) { console.warn('[projects] Could not delete file from disk:', file.path, err); }
    }

    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;
