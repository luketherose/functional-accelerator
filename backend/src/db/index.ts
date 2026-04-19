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
  CREATE INDEX IF NOT EXISTS idx_defects_project_created ON defects(project_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_defects_run_external_id ON defects(ingestion_run_id, external_id);

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

  CREATE TABLE IF NOT EXISTS cluster_configs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    cluster_key TEXT NOT NULL,
    cluster_name TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, cluster_key)
  );

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

  CREATE TABLE IF NOT EXISTS risk_overrides (
    id TEXT PRIMARY KEY,
    defect_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    original_priority TEXT NOT NULL,
    overridden_priority TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (defect_id) REFERENCES defects(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(defect_id)
  );

  CREATE INDEX IF NOT EXISTS idx_risk_overrides_project ON risk_overrides(project_id);
`);

// --- FTS5 full-text search index (BM25) for hybrid retrieval ---
// External-content-like approach: we store chunk_id as UNINDEXED so we can
// join back to file_chunks. The FTS5 virtual table is kept in sync manually
// by bm25Store.indexChunksFTS() / deleteChunksFTS().
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS file_chunks_fts USING fts5(
    chunk_id   UNINDEXED,
    project_id UNINDEXED,
    bucket     UNINDEXED,
    section_path,
    content,
    tokenize='unicode61'
  )
`);

// --- Knowledge Graph tables ---

db.exec(`
  CREATE TABLE IF NOT EXISTS kg_entities (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_id      TEXT REFERENCES files(id) ON DELETE SET NULL,
    chunk_id     TEXT REFERENCES file_chunks(id) ON DELETE SET NULL,
    domain       TEXT NOT NULL DEFAULT 'functional',
    entity_type  TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    source_quote TEXT,
    section_path TEXT,
    confidence   REAL NOT NULL DEFAULT 0.8,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    source_count INTEGER NOT NULL DEFAULT 1,
    relation_count INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migrations for kg_entities — run BEFORE creating indexes that depend on new columns
{
  const kgCols = db.prepare("PRAGMA table_info(kg_entities)").all() as { name: string }[];
  if (kgCols.length > 0 && !kgCols.find(c => c.name === 'domain')) {
    console.log('[DB] Adding domain column to kg_entities...');
    db.exec("ALTER TABLE kg_entities ADD COLUMN domain TEXT NOT NULL DEFAULT 'functional'");
  }
  if (kgCols.length > 0 && !kgCols.find(c => c.name === 'occurrence_count')) {
    db.exec('ALTER TABLE kg_entities ADD COLUMN occurrence_count INTEGER NOT NULL DEFAULT 1');
    db.exec('ALTER TABLE kg_entities ADD COLUMN source_count INTEGER NOT NULL DEFAULT 1');
    db.exec('ALTER TABLE kg_entities ADD COLUMN relation_count INTEGER NOT NULL DEFAULT 0');
  }
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_kg_entities_project      ON kg_entities(project_id);
  CREATE INDEX IF NOT EXISTS idx_kg_entities_domain       ON kg_entities(project_id, domain);
  CREATE INDEX IF NOT EXISTS idx_kg_entities_type         ON kg_entities(project_id, entity_type);
  CREATE INDEX IF NOT EXISTS idx_kg_entities_chunk        ON kg_entities(chunk_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS kg_relations (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain            TEXT NOT NULL DEFAULT 'functional',
    source_entity_id  TEXT NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    target_entity_id  TEXT NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    relation_type     TEXT NOT NULL,
    confidence        REAL NOT NULL DEFAULT 0.7,
    source_quote      TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_entity_id, target_entity_id, relation_type)
  )
`);

// Migrations for kg_relations — run BEFORE creating indexes on new columns
{
  const kgRelCols = db.prepare("PRAGMA table_info(kg_relations)").all() as { name: string }[];
  if (kgRelCols.length > 0 && !kgRelCols.find(c => c.name === 'domain')) {
    console.log('[DB] Adding domain column to kg_relations...');
    db.exec("ALTER TABLE kg_relations ADD COLUMN domain TEXT NOT NULL DEFAULT 'functional'");
  }
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_kg_relations_project ON kg_relations(project_id);
  CREATE INDEX IF NOT EXISTS idx_kg_relations_domain  ON kg_relations(project_id, domain);
  CREATE INDEX IF NOT EXISTS idx_kg_relations_source  ON kg_relations(source_entity_id);
  CREATE INDEX IF NOT EXISTS idx_kg_relations_target  ON kg_relations(target_entity_id);
`);

// --- Graph governance tables ---

db.exec(`
  CREATE TABLE IF NOT EXISTS graph_domain_settings (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain     TEXT NOT NULL,
    mode       TEXT NOT NULL DEFAULT 'assisted',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, domain)
  );

  CREATE TABLE IF NOT EXISTS graph_entity_type_config (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain       TEXT NOT NULL,
    type_key     TEXT NOT NULL,
    display_label TEXT NOT NULL,
    description  TEXT,
    discoverable INTEGER NOT NULL DEFAULT 1,
    enabled      INTEGER NOT NULL DEFAULT 1,
    is_base      INTEGER NOT NULL DEFAULT 0,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, domain, type_key)
  );

  CREATE INDEX IF NOT EXISTS idx_graph_entity_type_config_project ON graph_entity_type_config(project_id, domain);

  CREATE TABLE IF NOT EXISTS graph_suggestions (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain         TEXT NOT NULL,
    suggestion_type TEXT NOT NULL DEFAULT 'entity',
    entity_type    TEXT NOT NULL,
    name           TEXT NOT NULL,
    description    TEXT,
    source_quote   TEXT,
    section_path   TEXT,
    file_id        TEXT REFERENCES files(id) ON DELETE SET NULL,
    chunk_id       TEXT REFERENCES file_chunks(id) ON DELETE SET NULL,
    confidence     REAL NOT NULL DEFAULT 0.8,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    source_docs    TEXT NOT NULL DEFAULT '[]',
    why_suggested  TEXT,
    status         TEXT NOT NULL DEFAULT 'pending',
    resolved_at    TEXT,
    resolved_action TEXT,
    merged_into_id TEXT REFERENCES kg_entities(id) ON DELETE SET NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_graph_suggestions_project ON graph_suggestions(project_id, domain, status);

  CREATE TABLE IF NOT EXISTS graph_relation_suggestions (
    id                   TEXT PRIMARY KEY,
    project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain               TEXT NOT NULL,
    source_entity_name   TEXT NOT NULL,
    target_entity_name   TEXT NOT NULL,
    source_entity_id     TEXT REFERENCES kg_entities(id) ON DELETE SET NULL,
    target_entity_id     TEXT REFERENCES kg_entities(id) ON DELETE SET NULL,
    relation_type        TEXT NOT NULL,
    confidence           REAL NOT NULL DEFAULT 0.7,
    source_quote         TEXT,
    status               TEXT NOT NULL DEFAULT 'pending',
    resolved_at          TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_graph_rel_suggestions_project ON graph_relation_suggestions(project_id, domain, status);

  CREATE TABLE IF NOT EXISTS graph_governance_memory (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain      TEXT NOT NULL,
    memory_type TEXT NOT NULL,
    pattern     TEXT NOT NULL,
    action      TEXT NOT NULL,
    canonical   TEXT,
    metadata    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, domain, memory_type, pattern)
  );

  CREATE INDEX IF NOT EXISTS idx_graph_memory_project ON graph_governance_memory(project_id, domain);
`);

// --- Enrichment job queue ---

db.exec(`
  CREATE TABLE IF NOT EXISTS enrichment_jobs (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_id    TEXT REFERENCES files(id) ON DELETE CASCADE,
    job_type   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    payload    TEXT,
    error      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status  ON enrichment_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_project ON enrichment_jobs(project_id);
`);

// --- Functional Gap Analysis Engine tables ---

db.exec(`
  CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL DEFAULT 1,
    version_label TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    extracted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(file_id, version_number)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS functional_components (
    id TEXT PRIMARY KEY,
    document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    condition_text TEXT,
    action_text TEXT,
    source_section TEXT NOT NULL,
    source_quote TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    embedding BLOB,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS component_relationships (
    id TEXT PRIMARY KEY,
    from_component_id TEXT NOT NULL REFERENCES functional_components(id) ON DELETE CASCADE,
    to_component_id TEXT NOT NULL REFERENCES functional_components(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,
    source_quote TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS functional_analysis_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    as_is_version_ids TEXT NOT NULL DEFAULT '[]',
    to_be_version_ids TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    progress_step TEXT,
    alignment_threshold REAL NOT NULL DEFAULT 0.75,
    extraction_prompt_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS alignment_pairs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES functional_analysis_runs(id) ON DELETE CASCADE,
    as_is_component_id TEXT REFERENCES functional_components(id),
    to_be_component_id TEXT REFERENCES functional_components(id),
    match_type TEXT NOT NULL,
    confidence REAL,
    match_reason TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS functional_gaps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES functional_analysis_runs(id) ON DELETE CASCADE,
    alignment_pair_id TEXT NOT NULL REFERENCES alignment_pairs(id),
    gap_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    field_diffs TEXT,
    as_is_quote TEXT,
    to_be_quote TEXT,
    as_is_section TEXT,
    to_be_section TEXT,
    explanation TEXT,
    confidence REAL,
    verification_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS gap_impacts (
    id TEXT PRIMARY KEY,
    gap_id TEXT NOT NULL REFERENCES functional_gaps(id) ON DELETE CASCADE,
    affected_component_id TEXT NOT NULL REFERENCES functional_components(id),
    relationship_path TEXT NOT NULL DEFAULT '[]',
    impact_type TEXT NOT NULL DEFAULT 'downstream'
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS coverage_reports (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE REFERENCES functional_analysis_runs(id) ON DELETE CASCADE,
    total_as_is_components INTEGER NOT NULL DEFAULT 0,
    unchanged_count INTEGER NOT NULL DEFAULT 0,
    modified_count INTEGER NOT NULL DEFAULT 0,
    missing_count INTEGER NOT NULL DEFAULT 0,
    new_count INTEGER NOT NULL DEFAULT 0,
    coverage_score REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_functional_runs_project ON functional_analysis_runs(project_id);
  CREATE INDEX IF NOT EXISTS idx_functional_components_version ON functional_components(document_version_id);
  CREATE INDEX IF NOT EXISTS idx_alignment_pairs_run ON alignment_pairs(run_id);
  CREATE INDEX IF NOT EXISTS idx_functional_gaps_run ON functional_gaps(run_id);
  CREATE INDEX IF NOT EXISTS idx_gap_impacts_gap ON gap_impacts(gap_id);
`);

// --- Migration: rebuild FTS5 index from file_chunks ---
// We rebuild every startup to ensure consistency (fast — SQLite BLOB scan is cheap).
// FTS5 COUNT(*) without MATCH is unreliable, so we always rebuild.
{
  const chunkCount = (db.prepare('SELECT COUNT(*) as c FROM file_chunks').get() as { c: number }).c;

  if (chunkCount > 0) {
    console.log(`[DB] Rebuilding FTS5 index from ${chunkCount} file_chunks…`);
    const chunks = db.prepare(
      'SELECT id, project_id, bucket, section_path, content FROM file_chunks'
    ).all() as { id: string; project_id: string; bucket: string; section_path: string; content: string }[];

    const ins = db.prepare(
      'INSERT INTO file_chunks_fts(chunk_id, project_id, bucket, section_path, content) VALUES (?, ?, ?, ?, ?)'
    );
    const rebuild = db.transaction(() => {
      db.exec('DELETE FROM file_chunks_fts');
      for (const c of chunks) ins.run(c.id, c.project_id, c.bucket, c.section_path, c.content);
    });
    rebuild();
    console.log(`[DB] FTS5 rebuild complete.`);
  }
}

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
