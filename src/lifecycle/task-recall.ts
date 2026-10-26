/**
 * Task-aware recall used by prompt injection and by `/memory-recall` when no
 * query is typed: the current request is the query.
 */

import type { RecallHit } from '../cognition/schema.js'
import type { MemoryService } from '../services/memory-service.js'

/** Choose the query text for the current task. */
export function buildTaskQuery(input: string | undefined, fallback: string): string {
  const text = (input ?? '').trim()
  if (text.length > 0) return text.slice(0, 2_000)
  return fallback.trim().slice(0, 2_000)
}

/**
 * Recall memories relevant to one task.
 *
 * With no usable text this degrades to the most important memories, so the
 * prompt section never depends on a successful capture.
 */
export function recallForTask(
  service: MemoryService,
  task: string | undefined,
  limit = 6,
): RecallHit[] {
  const query = buildTaskQuery(task, service.lastTask)
  if (query.length === 0) return service.highlights(limit)
  return service.recallSync({ text: query, limit })
}
