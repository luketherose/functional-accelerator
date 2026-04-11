import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || './data/app.db';
const dbDir = path.dirname(DB_PATH);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    bucket TEXT NOT NULL,
    path TEXT NOT NULL,
    extracted_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    version_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    input_summary TEXT,
    result_json TEXT,
    error_message TEXT,
    progress_step TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS risk_assessments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    version_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    defect_count INTEGER,
    result_json TEXT,
    error_message TEXT,
    progress_step TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS impact_prototypes (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    impact_id TEXT NOT NULL,
    image_data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS impact_feedback (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    impact_id TEXT NOT NULL,
    sentiment TEXT NOT NULL CHECK(sentiment IN ('positive', 'negative')),
    motivation TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE,
    UNIQUE(analysis_id, impact_id)
  );

  CREATE TABLE IF NOT EXISTS file_chunks (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    bucket TEXT NOT NULL,
    section_path TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    embedding BLOB,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_file_chunks_project_bucket
    ON file_chunks(project_id, bucket);

  CREATE TABLE IF NOT EXISTS uat_analyses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    version_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    file_name TEXT,
    defect_count INTEGER,
    result_json TEXT,
    error_message TEXT,
    progress_step TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ingestion_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    uat_analysis_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    defect_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (uat_analysis_id) REFERENCES uat_analyses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS defects (
    id TEXT PRIMARY KEY,
    external_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    ingestion_run_id TEXT NOT NULL,
    title TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT,
    application TEXT,
    module TEXT,
    description TEXT,
    resolution TEXT,
    detected_by TEXT,
    assigned_to TEXT,
    detected_date TEXT,
    closed_date TEXT,
    environment TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (ingestion_run_id) REFERENCES ingestion_runs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_defects_project ON defects(project_id);
  CREATE INDEX IF NOT EXISTS idx_defects_ingestion ON defects(ingestion_run_id);

  CREATE TABLE IF NOT EXISTS cluster_assignments (
    id TEXT PRIMARY KEY,
    uat_analysis_id TEXT NOT NULL,
    defect_id TEXT NOT NULL,
    cluster_key TEXT NOT NULL,
    cluster_name TEXT NOT NULL,
    method TEXT NOT NULL,
    matched_keywords TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (uat_analysis_id) REFERENCES uat_analyses(id) ON DELETE CASCADE,
    FOREIGN KEY (defect_id) REFERENCES defects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_cluster_assignments_analysis ON cluster_assignments(uat_analysis_id);
  CREATE INDEX IF NOT EXISTS idx_cluster_assignments_cluster ON cluster_assignments(uat_analysis_id, cluster_key);

  CREATE TABLE IF NOT EXISTS open_question_feedback (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    question_text TEXT NOT NULL,
    sentiment TEXT CHECK(sentiment IN ('positive', 'negative')),
    answer TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE,
    UNIQUE(analysis_id, question_text)
  );
`);

// --- Migration: add progress_step to analyses if missing ---
const analysesCols = db.prepare("PRAGMA table_info(analyses)").all() as { name: string }[];
if (analysesCols.length > 0 && !analysesCols.find(c => c.name === 'progress_step')) {
  console.log('[DB] Adding progress_step column to analyses...');
  db.exec('ALTER TABLE analyses ADD COLUMN progress_step TEXT');
}

// --- Migration: recreate impact_prototypes if it uses old 'html' column ---
const cols = db.prepare("PRAGMA table_info(impact_prototypes)").all() as { name: string }[];
if (cols.length > 0 && !cols.find(c => c.name === 'image_data')) {
  console.log('[DB] Migrating impact_prototypes table to image_data schema...');
  db.pragma('foreign_keys = OFF');
  db.exec(`
    DROP TABLE IF EXISTS impact_prototypes;
    CREATE TABLE impact_prototypes (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL,
      impact_id TEXT NOT NULL,
      image_data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
    );
  `);
  db.pragma('foreign_keys = ON');
  console.log('[DB] Migration complete.');
}

console.log('[DB] SQLite initialized at', path.resolve(DB_PATH));

export default db;
