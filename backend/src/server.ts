import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { Request, Response, NextFunction } from 'express';

// Initialize DB on startup
import './db';

import projectsRouter from './routes/projects';
import filesRouter from './routes/files';
import analysisRouter from './routes/analysis';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// --- Middleware ---
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', mock: process.env.CLAUDE_MOCK === 'true' }));

// --- API Routes ---
app.use('/api/projects', projectsRouter);
app.use('/api/files', filesRouter);
app.use('/api/analysis', analysisRouter);

// --- Error handler ---
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// --- 404 handler ---
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Functional Accelerator backend running on http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.CLAUDE_MOCK === 'true' ? '🔶 MOCK' : '🟢 REAL Claude API'}`);
  console.log(`   Model: ${process.env.CLAUDE_MODEL || 'claude-opus-4-5'}\n`);
});
