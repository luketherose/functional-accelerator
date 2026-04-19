/**
 * Progressive enrichment queue — runs background jobs after fast indexing.
 *
 * Architecture:
 * - Jobs are persisted in the `enrichment_jobs` SQLite table
 * - On application startup, any pending/failed jobs are re-queued (crash recovery)
 * - New jobs are enqueued via `enqueueEnrichment()`
 * - The worker loop processes one job at a time using setImmediate (cooperative)
 * - This keeps the main event loop responsive while making progress
 *
 * Current job types:
 *   entity_extraction — run entityExtractor on a file's chunks
 *
 * Extension: add new job types by registering handlers in JOB_HANDLERS below.
 */

import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { extractEntitiesFromFile } from './entityExtractor';
import { runFunctionalGraphExtraction } from './functionalGraphExtractor';

// ─── Types ────────────────────────────────────────────────────────────────────

type JobType = 'entity_extraction' | 'functional_graph_extraction';
type JobStatus = 'pending' | 'running' | 'done' | 'failed';

interface EnrichmentJobRow {
  id: string;
  project_id: string;
  file_id: string | null;
  job_type: JobType;
  status: JobStatus;
  payload: string | null;
  error: string | null;
  created_at: string;
}

interface JobPayload {
  fileId?: string;
  projectId: string;
}

// ─── State ────────────────────────────────────────────────────────────────────

let isWorkerRunning = false;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enqueue an entity extraction job for a newly indexed file.
 * Called by vectorStore.indexFile() after embedding completes.
 */
export function enqueueEnrichment(projectId: string, fileId: string): void {
  const payload: JobPayload = { projectId, fileId };
  const enqueue = db.prepare(`
    INSERT INTO enrichment_jobs (id, project_id, file_id, job_type, status, payload)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `);
  db.transaction(() => {
    enqueue.run(uuidv4(), projectId, fileId, 'entity_extraction' as JobType, JSON.stringify(payload));
    enqueue.run(uuidv4(), projectId, fileId, 'functional_graph_extraction' as JobType, JSON.stringify(payload));
  })();
  scheduleWorker();
}

/**
 * On startup: re-queue any pending or previously-failed jobs.
 * Call this once from server startup (e.g. in app.ts / server.ts).
 */
export function resumePendingJobs(): void {
  const stale = db.prepare(
    `SELECT * FROM enrichment_jobs WHERE status IN ('pending', 'running') ORDER BY created_at ASC`
  ).all() as EnrichmentJobRow[];

  if (stale.length > 0) {
    console.log(`[enrichmentQueue] Resuming ${stale.length} pending enrichment job(s)…`);
    // Reset any running jobs to pending (they were interrupted by a crash)
    db.prepare(`UPDATE enrichment_jobs SET status = 'pending' WHERE status = 'running'`).run();
    scheduleWorker();
  }
}

/**
 * Return queue statistics (used by API endpoints for diagnostics).
 */
export function getQueueStats(projectId?: string): {
  pending: number; running: number; done: number; failed: number;
} {
  const base = projectId
    ? 'FROM enrichment_jobs WHERE project_id = ?'
    : 'FROM enrichment_jobs WHERE 1=1';
  const args = projectId ? [projectId] : [];

  const row = db.prepare(
    `SELECT
       SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,
       SUM(CASE WHEN status='done'    THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN status='failed'  THEN 1 ELSE 0 END) AS failed
     ${base}`
  ).get(...args) as { pending: number; running: number; done: number; failed: number } | undefined;

  return {
    pending: row?.pending ?? 0,
    running: row?.running ?? 0,
    done: row?.done ?? 0,
    failed: row?.failed ?? 0,
  };
}

// ─── Worker ───────────────────────────────────────────────────────────────────

function scheduleWorker(): void {
  if (!isWorkerRunning) {
    setImmediate(runNextJob);
  }
}

async function runNextJob(): Promise<void> {
  // Claim next pending job atomically
  const job = db.prepare(
    `SELECT * FROM enrichment_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`
  ).get() as EnrichmentJobRow | undefined;

  if (!job) {
    isWorkerRunning = false;
    return;
  }

  isWorkerRunning = true;

  db.prepare(`UPDATE enrichment_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?`)
    .run(job.id);

  try {
    await processJob(job);
    db.prepare(`UPDATE enrichment_jobs SET status = 'done', updated_at = datetime('now') WHERE id = ?`)
      .run(job.id);
    console.log(`[enrichmentQueue] Job ${job.id} (${job.job_type}) completed.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(`UPDATE enrichment_jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(msg.slice(0, 500), job.id);
    console.warn(`[enrichmentQueue] Job ${job.id} (${job.job_type}) failed:`, msg);
  }

  // Schedule next job cooperatively (yield to event loop first)
  setImmediate(runNextJob);
}

async function processJob(job: EnrichmentJobRow): Promise<void> {
  const payload = job.payload ? (JSON.parse(job.payload) as JobPayload) : null;
  if (!payload) throw new Error('Missing job payload');

  switch (job.job_type) {
    case 'entity_extraction': {
      if (!payload.fileId) throw new Error('entity_extraction requires fileId in payload');
      const result = await extractEntitiesFromFile(payload.fileId, payload.projectId);
      console.log(
        `[enrichmentQueue] Entity extraction: ${result.entitiesFound} entities, ` +
        `${result.relationsFound} relations for file ${payload.fileId}`
      );
      break;
    }
    case 'functional_graph_extraction': {
      if (!payload.fileId) throw new Error('functional_graph_extraction requires fileId in payload');
      const result = await runFunctionalGraphExtraction(payload.projectId, payload.fileId);
      console.log(
        `[enrichmentQueue] Functional graph extraction: ${result.entitiesFound} entities, ` +
        `${result.relationsFound} relations for file ${payload.fileId}`
      );
      break;
    }
    default:
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
}
