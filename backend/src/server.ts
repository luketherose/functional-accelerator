import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';

// Initialize DB on startup
import './db';

import projectsRouter from './routes/projects';
import filesRouter from './routes/files';
import analysisRouter from './routes/analysis';
import riskRouter from './routes/risk';
import uatRouter from './routes/uat';
import functionalRouter from './routes/functional';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// --- Middleware ---
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',');
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '500kb' }));

// --- Security headers ---
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  next();
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// --- API Routes ---
app.use('/api/projects', projectsRouter);
app.use('/api/files', filesRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/risk', riskRouter);
app.use('/api/uat', uatRouter);
app.use('/api/functional', functionalRouter);

// --- Error handler ---
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const isDev = process.env.NODE_ENV !== 'production';
  console.error('[server] Unhandled error:', err.message, isDev ? err.stack : '');
  res.status(500).json({ error: isDev ? err.message : 'Internal server error' });
});

// --- 404 handler ---
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Functional Accelerator backend running on http://localhost:${PORT}`);
  console.log(`   Model: ${process.env.CLAUDE_MODEL || 'claude-opus-4-5'}\n`);
});
