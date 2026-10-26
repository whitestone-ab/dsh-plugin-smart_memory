import { resolve, win32 } from 'node:path'
import type { MemoryScope } from './schema.js'

export interface MemoryNamespace {
  scope: MemoryScope
  projectPath?: string
}

/**
 * Normalize project paths for consistent comparison.
 * Windows drive paths are compared case-insensitively.
 */
export function normalizeProjectPath(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined

  const windowsPath =
    /^[a-z]:[\\/]/iu.test(trimmed) ||
    /^\\\\/u.test(trimmed)

  if (windowsPath) {
    return win32.resolve(trimmed).toLowerCase()
  }

  const normalized = resolve(trimmed)
  return process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized
}

/**
 * Determine whether two memories may be compared or merged.
 *
 * Global memories share one namespace.
 * Project memories must have matching normalized paths.
 * Two project memories with no path remain compatible for legacy data.
 */
export function sameMemoryNamespace(
  left: MemoryNamespace,
  right: MemoryNamespace,
): boolean {
  if (left.scope !== right.scope) return false

  if (left.scope === 'global') return true

  return normalizeProjectPath(left.projectPath)
    === normalizeProjectPath(right.projectPath)
}
