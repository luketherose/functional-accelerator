import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { parseFile } from '../services/fileParsing';
import { FileBucket } from '../types';

const router = Router();

const UPLOADS_BASE = path.resolve(process.env.UPLOADS_PATH || './uploads');
if (!fs.existsSync(UPLOADS_BASE)) fs.mkdirSync(UPLOADS_BASE, { recursive: true });

const MAX_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '20', 10);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const projectId = req.params.projectId as string;
    const dir = path.join(UPLOADS_BASE, projectId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
      'text/markdown',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// GET /api/files/:projectId
router.get('/:projectId', (req: Request, res: Response) => {
  try {
    const files = db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC').all(req.params.projectId);
    res.json(files);
  } catch {
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// POST /api/files/:projectId/upload
router.post('/:projectId/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const bucket: FileBucket = (['as-is', 'to-be', 'business-rules'].includes(req.body.bucket)
      ? req.body.bucket
      : 'as-is') as FileBucket;

    // Async text extraction
    let extractedText: string | null = null;
    try {
      extractedText = await parseFile(req.file.path, req.file.mimetype);
    } catch (parseErr) {
      console.warn('[files] Text extraction failed:', parseErr);
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO files (id, project_id, name, original_name, mime_type, size, bucket, path, extracted_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.params.projectId,
      req.file.filename,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      bucket,
      req.file.path,
      extractedText
    );

    const fileRecord = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    res.status(201).json(fileRecord);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Upload failed';
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/files/:projectId/:fileId
router.delete('/:projectId/:fileId', (req: Request, res: Response) => {
  try {
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND project_id = ?').get(req.params.fileId, req.params.projectId) as { path: string } | undefined;
    if (!file) return res.status(404).json({ error: 'File not found' });

    try { fs.unlinkSync(file.path); } catch (_) {}
    db.prepare('DELETE FROM files WHERE id = ?').run(req.params.fileId);

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// GET /api/files/:projectId/:fileId/preview — serve file for frontend preview
router.get('/:projectId/:fileId/preview', (req: Request, res: Response) => {
  try {
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND project_id = ?').get(req.params.fileId, req.params.projectId) as { path: string; mime_type: string; original_name: string } | undefined;
    if (!file) return res.status(404).json({ error: 'File not found' });

    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${file.original_name}"`);
    res.sendFile(path.resolve(file.path));
  } catch {
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

export default router;
