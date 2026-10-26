/**
 * Write policy: decide whether a candidate is stored as a new memory, merged
 * into a near-duplicate, used to supersede a contradicted memory, or rejected.
 */

import type { MemoryEntry, MemoryEvidence, NormalizedCandidate } from './schema.js'
import { MAX_TAGS } from './schema.js'
import { tokenize } from './recall-policy.js'
import type { Conflict } from './conflict-check.js'
import { findConflicts } from './conflict-check.js'
import { sameMemoryNamespace } from './memory-namespace.js'

/** Tunables for the save policy. */
export interface SavePolicyOptions {
  /** Confidence below which a candidate is rejected. */
  minConfidence: number
  /** Jaccard similarity at or above which two memories are merged. */
  dedupeThreshold: number
}

export const DEFAULT_SAVE_POLICY: SavePolicyOptions = {
  minConfidence: 0.35,
  dedupeThreshold: 0.78,
}

/** Hard cap on stored evidence; the oldest few plus the newest rest survive. */
const MAX_EVIDENCE_ITEMS = 20
/** How many of the earliest observations survive the cap, to keep provenance. */
const OLDEST_EVIDENCE_KEPT = 5

/** True when an observation carries actual quoted source text. */
function hasValidQuote(item: MemoryEvidence): boolean {
  const quote: unknown = item.quote
  return typeof quote === 'string' && quote.trim().length > 0
}

/** Stable identity of one real observation: provenance plus the quoted text. */
function evidenceKey(item: MemoryEvidence): string {
  return `${item.source}\u0000${(item.quote ?? '').trim()}`
}

/** Total order: chronological, then provenance, then quote. ASCII-safe. */
function compareEvidence(a: MemoryEvidence, b: MemoryEvidence): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1
  if (a.source !== b.source) return a.source < b.source ? -1 : 1
  const left = a.quote ?? ''
  const right = b.quote ?? ''
  if (left !== right) return left < right ? -1 : 1
  return 0
}

/**
 * Merge evidence histories with deduplication, chronological ordering, and a
 * bounded history. Past the cap, the earliest `OLDEST_EVIDENCE_KEPT` are kept
 * alongside the most recent remainder, so initial provenance is not silently
 * discarded as a memory accumulates observations.
 *
 * Evidence without quoted text is a placeholder — the mark left by a save that
 * carried no evidence, not an observation. Placeholders therefore never take a
 * slot in the bounded window: once any real evidence exists they are dropped,
 * and while none exists a single earliest placeholder stands in.
 */
function mergeEvidenceHistory(
  existing: readonly MemoryEvidence[],
  incoming: readonly MemoryEvidence[],
): MemoryEvidence[] {
  const placeholders: MemoryEvidence[] = []
  const real: MemoryEvidence[] = []
  for (const item of [...existing, ...incoming]) {
    if (hasValidQuote(item)) real.push(item)
    else placeholders.push(item)
  }

  // Sort before deduplicating so a repeated source+quote keeps the earliest `at`.
  real.sort(compareEvidence)

  const seen = new Set<string>()
  const unique: MemoryEvidence[] = []
  for (const item of real) {
    const key = evidenceKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }

  if (unique.length === 0) {
    placeholders.sort(compareEvidence)
    return placeholders.slice(0, 1)
  }

  if (unique.length <= MAX_EVIDENCE_ITEMS) return unique
  const newestCount = MAX_EVIDENCE_ITEMS - OLDEST_EVIDENCE_KEPT
  return [
    ...unique.slice(0, OLDEST_EVIDENCE_KEPT),
    ...unique.slice(-newestCount),
  ]
}

/** The four possible write decisions. */
export type SaveAction = 'insert' | 'merge' | 'supersede' | 'reject'

/** Result of planning one save. */
export interface SavePlan {
  action: SaveAction
  reason: string
  targetId?: string
  conflicts: Conflict[]
}

/**
 * Similarity for duplicate detection.
 *
 * Jaccard alone punishes a short restatement that keeps every meaningful term
 * of the original, so the containment coefficient (intersection over the
 * smaller set) is folded in. Taking the maximum keeps genuinely different
 * memories — same template, different value — safely apart.
 */
export function textSimilarity(left: string, right: string): number {
  const a = new Set(tokenize(left))
  const b = new Set(tokenize(right))
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection += 1
  }
  const jaccard = intersection / (a.size + b.size - intersection)
  const containment = intersection / Math.min(a.size, b.size)
  return Math.max(jaccard, containment)
}

/**
 * Find the most similar active memory. Only the same scope is compared so a
 * project fact is never merged into a global one.
 */
export function findSimilar(
  candidate: NormalizedCandidate,
  entries: readonly MemoryEntry[],
  threshold: number,
): MemoryEntry | undefined {
  let best: MemoryEntry | undefined
  let bestScore = 0
  for (const entry of entries) {
    if (entry.status !== 'active') continue
    if (!sameMemoryNamespace(entry, candidate)) continue
    // Compare the statements themselves; titles are truncated labels and would
    // add noise that lowers similarity for otherwise identical memories.
    const score = textSimilarity(candidate.content, entry.content)
    if (score > bestScore) {
      best = entry
      bestScore = score
    }
  }
  return bestScore >= threshold ? best : undefined
}

/**
 * Plan one save.
 *
 * A contradiction is resolved before duplicate detection: if the candidate says
 * something different about the same subject/predicate, the old memory must be
 * superseded rather than merged into.
 */
export function planSave(
  candidate: NormalizedCandidate,
  confidence: number,
  entries: readonly MemoryEntry[],
  options: SavePolicyOptions = DEFAULT_SAVE_POLICY,
): SavePlan {
  if (confidence < options.minConfidence) {
    return {
      action: 'reject',
      reason: `confidence ${confidence.toFixed(2)} is below the ${options.minConfidence.toFixed(2)} minimum`,
      conflicts: [],
    }
  }

  const conflicts = findConflicts(candidate, entries)
  const firstConflict = conflicts[0]
  if (firstConflict !== undefined) {
    return {
      action: 'supersede',
      reason: `contradicts "${firstConflict.existing.title}" (${firstConflict.kind})`,
      targetId: firstConflict.existing.id,
      conflicts,
    }
  }

  const similar = findSimilar(candidate, entries, options.dedupeThreshold)
  if (similar !== undefined) {
    return {
      action: 'merge',
      reason: `near-duplicate of "${similar.title}"`,
      targetId: similar.id,
      conflicts: [],
    }
  }

  return { action: 'insert', reason: 'no similar or conflicting memory found', conflicts: [] }
}

/**
 * Fold a candidate into an existing memory. The longer content wins (it is
 * usually the more complete statement), tags are unioned, and evidence is
 * appended with a bounded history.
 */
export function mergeEntries(
  existing: MemoryEntry,
  candidate: NormalizedCandidate,
  confidence: number,
  evidence: readonly MemoryEvidence[],
  now: Date = new Date(),
): MemoryEntry {
  const useIncoming = candidate.content.length >= existing.content.length
  const mergedEvidence = mergeEvidenceHistory(existing.evidence, evidence)
  return {
    ...existing,
    kind: existing.kind === 'episode' ? candidate.kind : existing.kind,
    title: useIncoming ? candidate.title : existing.title,
    content: useIncoming ? candidate.content : existing.content,
    tags: [...new Set([...existing.tags, ...candidate.tags])].slice(0, MAX_TAGS),
    importance: Math.max(existing.importance, candidate.importance),
    confidence: Math.max(existing.confidence, confidence),
    evidence: mergedEvidence,
    updatedAt: now.toISOString(),
    version: existing.version + 1,
    ...candidate.subject !== undefined ? { subject: candidate.subject } : {},
    ...candidate.predicate !== undefined ? { predicate: candidate.predicate } : {},
    ...candidate.value !== undefined ? { value: candidate.value } : {},
  }
}
