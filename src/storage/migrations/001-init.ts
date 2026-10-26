/**
 * Migration 001 — initial SQLite schema.
 *
 * The document itself is stored as JSON in `memories.doc`; columns exist only
 * for addressing, ordering, and future querying, so schema evolution stays
 * cheap while the memory model grows.
 */

export const id = '001-init'

export const sql = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS memories_updated_at ON memories (updated_at);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`
