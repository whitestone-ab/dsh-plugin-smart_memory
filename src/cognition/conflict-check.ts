/**
 * Contradiction detection between an incoming candidate and stored memories.
 *
 * Two signals are used:
 * 1. Structured conflicts — same `subject` + `predicate`, different `value`.
 * 2. Negation conflicts — highly similar text where exactly one side is
 *    negated ("use tabs" vs "do not use tabs").
 */

import type { MemoryCandidate, MemoryEntry, MemoryScope } from './schema.js'
import { jaccard, tokenize } from './recall-policy.js'
import { sameMemoryNamespace } from './memory-namespace.js'

/** Why two memories are considered to contradict each other. */
export type ConflictKind = 'value' | 'negation'

/** One detected contradiction. */
export interface Conflict {
  kind: ConflictKind
  existing: MemoryEntry
  detail: string
}

const NEGATION_MARKERS = ['not ', 'never ', "don't", 'do not', '不', '没', '别', '禁止', '不要', '不能']

/** True when the text contains an explicit negation marker. */
export function hasNegation(text: string): boolean {
  const lower = text.toLowerCase()
  return NEGATION_MARKERS.some(marker => lower.includes(marker))
}

/** Normalize a structured value for comparison. */
export function normalizeValue(value: string | undefined): string {
  if (value === undefined) return ''
  return value.trim().toLowerCase().replace(/[\s,.;:!?，。；：！？]+/gu, ' ')
}

/**
 * Find contradictions for a candidate.
 *
 * Structured conflicts win: when subject/predicate are present, the text-level
 * negation heuristic is skipped, because the structured comparison is precise.
 */
export function findConflicts(
  candidate: Pick<
    MemoryCandidate,
    'content' | 'subject' | 'predicate' | 'value' | 'projectPath'
  > & { scope: MemoryScope },
  entries: readonly MemoryEntry[],
): Conflict[] {
  const conflicts: Conflict[] = []
  const subject = candidate.subject?.trim().toLowerCase()
  const predicate = candidate.predicate?.trim().toLowerCase()
  const value = normalizeValue(candidate.value)

  if (subject !== undefined && predicate !== undefined && value.length > 0) {
    for (const entry of entries) {
      if (entry.status !== 'active') continue
      if (!sameMemoryNamespace(candidate, entry)) continue
      if (entry.subject?.trim().toLowerCase() !== subject) continue
      if (entry.predicate?.trim().toLowerCase() !== predicate) continue
      const existingValue = normalizeValue(entry.value)
      if (existingValue.length === 0 || existingValue === value) continue
      conflicts.push({
        kind: 'value',
        existing: entry,
        detail: `${subject}.${predicate} was "${existingValue}", now "${value}"`,
      })
    }
    return conflicts
  }

  const incomingTokens = tokenize(candidate.content)
  if (incomingTokens.length === 0) return conflicts
  const incomingNegated = hasNegation(candidate.content)
  for (const entry of entries) {
    if (entry.status !== 'active') continue
    if (!sameMemoryNamespace(candidate, entry)) continue
    const similarity = jaccard(incomingTokens, tokenize(entry.content))
    if (similarity < 0.6) continue
    if (hasNegation(entry.content) === incomingNegated) continue
    conflicts.push({
      kind: 'negation',
      existing: entry,
      detail: `candidate contradicts "${entry.title}" (negation differs, similarity ${similarity.toFixed(2)})`,
    })
  }
  return conflicts
}
