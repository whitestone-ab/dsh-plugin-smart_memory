#!/usr/bin/env node
/**
 * Snapshot the smart-memory SQLite database.
 *
 * Uses `VACUUM INTO`, which is safe against a live database (the running DSH
 * process keeps writing while the copy is made) and produces a compact,
 * self-contained file — unlike a plain file copy, which can capture a torn
 * WAL state.
 *
 * Usage:
 *   node scripts/backup-memory.cjs [source.sqlite] [destDir]
 *
 * Defaults: source = $DSH_HOME/smart-memory/memory.sqlite (or ~/.dsh/...)
 *           dest   = $DSH_HOME/smart-memory-backups
 */

const { DatabaseSync } = require('node:sqlite')
const { homedir } = require('node:os')
const { mkdirSync, existsSync, readdirSync, statSync, unlinkSync } = require('node:fs')
const { join, resolve } = require('node:path')

const KEEP = 20

function dshHome() {
  const configured = (process.env.DSH_HOME || '').trim()
  return configured.length > 0 ? configured : join(homedir(), '.dsh')
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

const source = resolve(process.argv[2] || join(dshHome(), 'smart-memory', 'memory.sqlite'))
const destDir = resolve(process.argv[3] || join(dshHome(), 'smart-memory-backups'))

if (!existsSync(source)) {
  console.error(`no database at ${source} — nothing to back up`)
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })
const dest = join(destDir, `memory-${stamp()}.sqlite`)

const db = new DatabaseSync(source)
try {
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
} finally {
  db.close()
}

const size = statSync(dest).size
console.log(`backup written: ${dest} (${size} bytes)`)

// Prune: keep the newest KEEP snapshots.
const snapshots = readdirSync(destDir)
  .filter((f) => /^memory-\d{8}-\d{6}\.sqlite$/.test(f))
  .map((f) => join(destDir, f))
  .sort()

const excess = snapshots.slice(0, Math.max(0, snapshots.length - KEEP))
for (const old of excess) {
  unlinkSync(old)
}
console.log(`${snapshots.length - excess.length} snapshot(s) retained in ${destDir}`)
