/**
 * Database Schema (DDL)
 *
 * Compatible with @libsql/client (Turso/libSQL).
 * NOTE: PRAGMA statements must be executed separately via client.execute(),
 * not included in the executeMultiple() call which handles the CREATE TABLE DDL.
 */

export const MEMORY_PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
`.trim();

export const MEMORY_SCHEMA_SQL = `
-- ============================================================
-- CORE MEMORY TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS memories (
  id                    TEXT PRIMARY KEY,
  type                  TEXT NOT NULL,
  content               TEXT NOT NULL,
  confidence            REAL NOT NULL DEFAULT 0.8,
  tags                  TEXT NOT NULL DEFAULT '[]',
  related_files         TEXT NOT NULL DEFAULT '[]',
  related_modules       TEXT NOT NULL DEFAULT '[]',
  created_at            TEXT NOT NULL,
  last_accessed_at      TEXT NOT NULL,
  access_count          INTEGER NOT NULL DEFAULT 0,
  session_id            TEXT,
  commit_sha            TEXT,
  scope                 TEXT NOT NULL DEFAULT 'global',
  work_unit_ref         TEXT,
  methodology           TEXT,
  source                TEXT NOT NULL DEFAULT 'agent_explicit',
  target_node_id        TEXT,
  impacted_node_ids     TEXT DEFAULT '[]',
  relations             TEXT NOT NULL DEFAULT '[]',
  decay_half_life_days  REAL,
  provenance_session_ids TEXT DEFAULT '[]',
  needs_review          INTEGER NOT NULL DEFAULT 0,
  user_verified         INTEGER NOT NULL DEFAULT 0,
  citation_text         TEXT,
  pinned                INTEGER NOT NULL DEFAULT 0,
  deprecated            INTEGER NOT NULL DEFAULT 0,
  deprecated_at         TEXT,
  stale_at              TEXT,
  project_id            TEXT NOT NULL,
  trust_level_scope     TEXT DEFAULT 'personal',
  chunk_type            TEXT,
  chunk_start_line      INTEGER,
  chunk_end_line        INTEGER,
  context_prefix        TEXT,
  embedding_model_id    TEXT
);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id   TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  embedding   BLOB NOT NULL,
  model_id    TEXT NOT NULL,
  dims        INTEGER NOT NULL DEFAULT 1024,
  created_at  TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  memory_id UNINDEXED,
  content,
  tags,
  related_files,
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS embedding_cache (
  key        TEXT PRIMARY KEY,
  embedding  BLOB NOT NULL,
  model_id   TEXT NOT NULL,
  dims       INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embedding_cache_expires ON embedding_cache(expires_at);

-- ============================================================
-- OBSERVER TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS observer_file_nodes (
  file_path         TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL,
  access_count      INTEGER NOT NULL DEFAULT 0,
  last_accessed_at  TEXT NOT NULL,
  session_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS observer_co_access_edges (
  file_a              TEXT NOT NULL,
  file_b              TEXT NOT NULL,
  project_id          TEXT NOT NULL,
  weight              REAL NOT NULL DEFAULT 0.0,
  raw_count           INTEGER NOT NULL DEFAULT 0,
  session_count       INTEGER NOT NULL DEFAULT 0,
  avg_time_delta_ms   REAL,
  directional         INTEGER NOT NULL DEFAULT 0,
  task_type_breakdown TEXT DEFAULT '{}',
  last_observed_at    TEXT NOT NULL,
  promoted_at         TEXT,
  PRIMARY KEY (file_a, file_b, project_id)
);

CREATE TABLE IF NOT EXISTS observer_error_patterns (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  tool_name        TEXT NOT NULL,
  error_fingerprint TEXT NOT NULL,
  error_message    TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at     TEXT NOT NULL,
  resolved_how     TEXT,
  sessions         TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS observer_module_session_counts (
  module      TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (module, project_id)
);

CREATE TABLE IF NOT EXISTS observer_synthesis_log (
  module          TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  trigger_count   INTEGER NOT NULL,
  synthesized_at  INTEGER NOT NULL,
  memories_generated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (module, project_id, trigger_count)
);

-- ============================================================
-- KNOWLEDGE GRAPH TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS graph_nodes (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  type            TEXT NOT NULL,
  label           TEXT NOT NULL,
  file_path       TEXT,
  language        TEXT,
  start_line      INTEGER,
  end_line        INTEGER,
  layer           INTEGER NOT NULL DEFAULT 1,
  source          TEXT NOT NULL,
  confidence      TEXT DEFAULT 'inferred',
  metadata        TEXT DEFAULT '{}',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  stale_at        INTEGER,
  associated_memory_ids TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_gn_project_type  ON graph_nodes(project_id, type);
CREATE INDEX IF NOT EXISTS idx_gn_project_label ON graph_nodes(project_id, label);
CREATE INDEX IF NOT EXISTS idx_gn_file_path     ON graph_nodes(project_id, file_path) WHERE file_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gn_stale         ON graph_nodes(stale_at) WHERE stale_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS graph_edges (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  from_id     TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 1,
  weight      REAL DEFAULT 1.0,
  source      TEXT NOT NULL,
  confidence  REAL DEFAULT 1.0,
  metadata    TEXT DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  stale_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ge_from_type ON graph_edges(from_id, type) WHERE stale_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ge_to_type   ON graph_edges(to_id, type)   WHERE stale_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ge_stale     ON graph_edges(stale_at) WHERE stale_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS graph_closure (
  ancestor_id   TEXT NOT NULL,
  descendant_id TEXT NOT NULL,
  depth         INTEGER NOT NULL,
  path          TEXT NOT NULL,
  edge_types    TEXT NOT NULL,
  total_weight  REAL NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id),
  FOREIGN KEY (ancestor_id)   REFERENCES graph_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (descendant_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gc_ancestor   ON graph_closure(ancestor_id, depth);
CREATE INDEX IF NOT EXISTS idx_gc_descendant ON graph_closure(descendant_id, depth);

CREATE TABLE IF NOT EXISTS graph_index_state (
  project_id       TEXT PRIMARY KEY,
  last_indexed_at  INTEGER NOT NULL,
  last_commit_sha  TEXT,
  node_count       INTEGER DEFAULT 0,
  edge_count       INTEGER DEFAULT 0,
  stale_edge_count INTEGER DEFAULT 0,
  index_version    INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS scip_symbols (
  symbol_id  TEXT PRIMARY KEY,
  node_id    TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scip_node ON scip_symbols(node_id);

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_memories_project_type     ON memories(project_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_project_scope    ON memories(project_id, scope);
CREATE INDEX IF NOT EXISTS idx_memories_source           ON memories(source);
CREATE INDEX IF NOT EXISTS idx_memories_needs_review     ON memories(needs_review) WHERE needs_review = 1;
CREATE INDEX IF NOT EXISTS idx_memories_confidence       ON memories(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_memories_last_accessed    ON memories(last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_type_conf        ON memories(project_id, type, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_memories_not_deprecated   ON memories(project_id, deprecated) WHERE deprecated = 0;
CREATE INDEX IF NOT EXISTS idx_co_access_weight         ON observer_co_access_edges(weight DESC);
`.trim();
