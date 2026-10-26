/**
 * Ordered schema migrations. Append new files here; never edit a shipped
 * migration, because existing databases have already applied it.
 */

import { id as initId, sql as initSql } from './001-init.js'

export interface Migration {
  id: string
  sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  { id: initId, sql: initSql },
]
