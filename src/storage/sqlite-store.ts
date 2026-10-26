/**
 * Durable storage for memory records.
 *
 * The preferred backend is `node:sqlite` (Node 24 ships it unflagged; Node 22
 * exposes it behind `--experimental-sqlite`). When the module is unavailable,
 * the store falls back to an atomically-written JSON file so the plugin still
 * works on older runtimes. Both backends implement the same {@link Persistence}
 * contract, and neither is ever written partially.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { MemoryEntry } from '../cognition/schema.js'
import { isMemoryKind, isMemoryScope, isMemoryStatus } from '../cognition/schema.js'
import { MIGRATIONS } from './migrations/index.js'

/** Minimal statement surface used by the SQLite backend. */
interface SqliteStatement {
  run(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

/** Minimal database surface used by the SQLite backend. */
interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

/** Shape of the optional `node:sqlite` module. */
interface SqliteModule {
  DatabaseSync: new (location: string) => SqliteDatabase
}

/** Durable record access used by {@link MemoryStore}. */
export interface Persistence {
  readonly driver: 'sqlite' | 'json'
  readonly location: string
  load(): Promise<MemoryEntry[]>
  save(entry: MemoryEntry): Promise<void>
  remove(id: string): Promise<void>
  close(): Promise<void>
}

/** Load `node:sqlite` when the current runtime provides it. */
function loadSqlite(): SqliteModule | undefined {
  try {
    const require = createRequire(import.meta.url)
    const candidate = require('node:sqlite') as Partial<SqliteModule>
    return typeof candidate.DatabaseSync === 'function'
      ? candidate as SqliteModule
      : undefined
  } catch {
    return undefined
  }
}

/** Runtime validation for persisted JSON, so one corrupt row cannot poison the store. */
function isEntry(value: unknown): value is MemoryEntry {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string'
    && typeof record.content === 'string'
    && typeof record.title === 'string'
    && isMemoryKind(record.kind)
    && isMemoryScope(record.scope)
    && isMemoryStatus(record.status)
    && typeof record.confidence === 'number'
    && typeof record.importance === 'number'
    && Array.isArray(record.tags)
    && Array.isArray(record.evidence)
}

/** Parse one JSON document, rejecting malformed records. */
function parseEntry(doc: string): MemoryEntry | undefined {
  try {
    const value: unknown = JSON.parse(doc)
    return isEntry(value) ? value : undefined
  } catch {
    return undefined
  }
}

class SqlitePersistence implements Persistence {
  readonly driver = 'sqlite'

  private readonly upsertStmt: SqliteStatement
  private readonly allStmt: SqliteStatement
  private readonly removeStmt: SqliteStatement
  private closed = false

  private constructor(
    readonly location: string,
    private readonly db: SqliteDatabase,
  ) {
    for (const migration of MIGRATIONS) db.exec(migration.sql)
    this.upsertStmt = db.prepare(
      'INSERT INTO memories (id, doc, updated_at) VALUES (?, ?, ?) '
      + 'ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at',
    )
    this.allStmt = db.prepare('SELECT doc FROM memories ORDER BY updated_at ASC')
    this.removeStmt = db.prepare('DELETE FROM memories WHERE id = ?')
  }

  static open(location: string): SqlitePersistence {
    const sqlite = loadSqlite()
    if (sqlite === undefined) throw new Error('node:sqlite is not available')
    return new SqlitePersistence(location, new sqlite.DatabaseSync(location))
  }

  async load(): Promise<MemoryEntry[]> {
    const rows = this.allStmt.all()
    const entries: MemoryEntry[] = []
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue
      const doc = (row as { doc?: unknown }).doc
      if (typeof doc !== 'string') continue
      const entry = parseEntry(doc)
      if (entry !== undefined) entries.push(entry)
    }
    return entries
  }

  async save(entry: MemoryEntry): Promise<void> {
    this.upsertStmt.run(entry.id, JSON.stringify(entry), entry.updatedAt)
  }

  async remove(id: string): Promise<void> {
    this.removeStmt.run(id)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }
}

class JsonPersistence implements Persistence {
  readonly driver = 'json'

  private readonly data = new Map<string, MemoryEntry>()
  private queue: Promise<void> = Promise.resolve()

  constructor(readonly location: string) {}

  async load(): Promise<MemoryEntry[]> {
    let raw: string
    try {
      raw = await readFile(this.location, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    if (raw.trim().length === 0) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`memory store at ${this.location} is not valid JSON: ${String(error)}`)
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`memory store at ${this.location} must contain a JSON array`)
    }
    for (const value of parsed) {
      if (isEntry(value)) this.data.set(value.id, value)
    }
    return [...this.data.values()]
  }

  async save(entry: MemoryEntry): Promise<void> {
    this.data.set(entry.id, entry)
    await this.enqueue()
  }

  async remove(id: string): Promise<void> {
    this.data.delete(id)
    await this.enqueue()
  }

  async close(): Promise<void> {
    await this.queue
  }

  /** Serialize flushes so concurrent saves cannot interleave writes. */
  private enqueue(): Promise<void> {
    const next = this.queue.then(() => this.flush())
    this.queue = next.catch(() => undefined)
    return next
  }

  private async flush(): Promise<void> {
    await mkdir(dirname(this.location), { recursive: true })
    const temporary = `${this.location}.tmp`
    await writeFile(temporary, `${JSON.stringify([...this.data.values()], null, 2)}\n`, 'utf8')
    await rename(temporary, this.location)
  }
}

/**
 * Open durable storage at `basePath` (without extension).
 *
 * @param basePath - absolute path stem; `.sqlite` or `.json` is appended.
 * @returns the best available backend.
 */
export async function openPersistence(basePath: string): Promise<Persistence> {
  await mkdir(dirname(basePath), { recursive: true })
  if (loadSqlite() !== undefined) {
    try {
      return SqlitePersistence.open(`${basePath}.sqlite`)
    } catch {
      // Fall through to the JSON backend rather than making the plugin unusable.
    }
  }
  return new JsonPersistence(`${basePath}.json`)
}
