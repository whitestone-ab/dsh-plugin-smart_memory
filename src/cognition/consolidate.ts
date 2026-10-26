/**
 * Consolidation: merge duplicates, promote frequently used episodes, and
 * archive stale low-confidence memories. The plan is computed purely; the
 * service applies it and persists the result.
 */

import type { MemoryEntry } from './schema.js'
import { MAX_TAGS } from './schema.js'
import { textSimilarity } from './save-policy.js'
import { sameMemoryNamespace } from './memory-namespace.js'

/** Tunables for one consolidation pass. */
export interface ConsolidationOptions {
  similarityThreshold: number
  archiveAfterDays: number
  archiveBelowConfidence: number
  /** Access count at which an episode is promoted to a durable fact. */
  promotionAccessCount: number
}

export const DEFAULT_CONSOLIDATION: ConsolidationOptions = {
  similarityThreshold: 0.85,
  archiveAfterDays: 180,
  archiveBelowConfidence: 0.25,
  promotionAccessCount: 3,
}

/** A cluster of duplicates collapsed into one surviving record. */
export interface MergeGroup {
  keep: MemoryEntry
  dropIds: string[]
  merged: MemoryEntry
}

/** Everything one consolidation pass intends to change. */
export interface ConsolidationPlan {
  merges: MergeGroup[]
  archiveIds: string[]
  promoteIds: string[]
}

/** Fold a duplicate cluster into one record. */
function mergeCluster(cluster: readonly MemoryEntry[], now: Date): MemoryEntry {
  const ordered = [...cluster].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
  const keep = ordered[0]
  if (keep === undefined) throw new Error('cannot merge an empty cluster')
  const longest = ordered.reduce((best, entry) => entry.content.length > best.content.length ? entry : best, keep)
  return {
    ...keep,
    title: longest.title,
    content: longest.content,
    tags: [...new Set(ordered.flatMap(entry => entry.tags))].slice(0, MAX_TAGS),
    evidence: ordered.flatMap(entry => entry.evidence).slice(-20),
    confidence: Math.max(...ordered.map(entry => entry.confidence)),
    importance: Math.max(...ordered.map(entry => entry.importance)),
    accessCount: ordered.reduce((sum, entry) => sum + entry.accessCount, 0),
    updatedAt: now.toISOString(),
    version: Math.max(...ordered.map(entry => entry.version)) + 1,
  }
}

/**
 * Plan one consolidation pass.
 *
 * Merging is greedy and deterministic: entries are visited in id order, and a
 * cluster only forms with the same kind and scope. Archiving only touches
 * memories that were never recalled and are both old and weakly supported.
 */
export function planConsolidation(
  entries: readonly MemoryEntry[],
  now: Date = new Date(),
  options: ConsolidationOptions = DEFAULT_CONSOLIDATION,
): ConsolidationPlan {
  const active = entries
    .filter(entry => entry.status === 'active')
    .sort((left, right) => left.id.localeCompare(right.id))
  const consumed = new Set<string>()
  const merges: MergeGroup[] = []

  for (const entry of active) {
    if (consumed.has(entry.id)) continue
    const cluster = [entry]
    for (const other of active) {
      if (other.id === entry.id || consumed.has(other.id)) continue
      if (other.kind !== entry.kind) continue
      if (!sameMemoryNamespace(entry, other)) continue
      const similarity = textSimilarity(
        `${entry.title} ${entry.content}`,
        `${other.title} ${other.content}`,
      )
      if (similarity < options.similarityThreshold) continue
      cluster.push(other)
      consumed.add(other.id)
    }
    if (cluster.length < 2) continue
    consumed.add(entry.id)
    merges.push({
      keep: entry,
      dropIds: cluster.slice(1).map(member => member.id),
      merged: mergeCluster(cluster, now),
    })
  }

  const mergedIds = new Set(merges.flatMap(group => [group.keep.id, ...group.dropIds]))
  const archiveIds: string[] = []
  for (const entry of active) {
    if (mergedIds.has(entry.id)) continue
    const ageDays = (now.getTime() - Date.parse(entry.updatedAt)) / 86_400_000
    if (Number.isNaN(ageDays)) continue
    if (ageDays < options.archiveAfterDays) continue
    if (entry.accessCount > 0) continue
    if (entry.confidence >= options.archiveBelowConfidence) continue
    archiveIds.push(entry.id)
  }

  const mergedDropIds = new Set(merges.flatMap(group => group.dropIds))
  const excludedFromPromotion = new Set([
    ...mergedDropIds,
    ...archiveIds,
  ])

  const promoteIds = active
    .filter(entry =>
      !excludedFromPromotion.has(entry.id)
      && entry.kind === 'episode'
      && entry.accessCount >= options.promotionAccessCount,
    )
    .map(entry => entry.id)

  return { merges, archiveIds, promoteIds }
}
