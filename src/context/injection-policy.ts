/**
 * Context-injection policy: choose which memories deserve scarce prompt space
 * and render them as a compact, clearly-delimited section.
 */

import type { MemoryKind, RecallHit } from '../cognition/schema.js'

/** Injection configuration. */
export interface InjectionPolicy {
  /** Soft character budget for the rendered section. */
  budgetChars: number
  /** Hard cap on the number of memories injected. */
  maxItems: number
  /** Larger wins when two memories compete for the last slot. */
  kindPriority: Record<MemoryKind, number>
}

export const DEFAULT_INJECTION_POLICY: InjectionPolicy = {
  budgetChars: 1_200,
  maxItems: 8,
  kindPriority: {
    identity: 5,
    preference: 4,
    decision: 3,
    procedure: 2,
    fact: 2,
    episode: 1,
  },
}

const HEADER = [
  '## Persistent memory',
  '',
  'These memories were stored in earlier sessions. Treat them as background context:',
  'use them when relevant, prefer newer decisions over older ones, and never invent',
  'memories that are not listed here.',
  '',
].join('\n')

/**
 * Select hits for prompt injection.
 *
 * Priority first (identity and preferences outrank episodes), then recall score.
 * The budget is enforced on the rendered line length, not on the raw content, so
 * a single huge memory cannot crowd out every other one.
 */
export function selectForInjection(
  hits: readonly RecallHit[],
  policy: InjectionPolicy = DEFAULT_INJECTION_POLICY,
): RecallHit[] {
  const ordered = [...hits].sort((left, right) => {
    const priority = policy.kindPriority[right.entry.kind] - policy.kindPriority[left.entry.kind]
    if (priority !== 0) return priority
    return right.score - left.score
  })
  const selected: RecallHit[] = []
  let used = HEADER.length
  for (const hit of ordered) {
    if (selected.length >= policy.maxItems) break
    const cost = estimatedLineCost(hit)
    if (selected.length > 0 && used + cost > policy.budgetChars) continue
    selected.push(hit)
    used += cost
  }
  return selected
}

/** Approximate rendered cost of one memory line. */
function estimatedLineCost(hit: RecallHit): number {
  const entry = hit.entry
  return entry.title.length + entry.content.length + entry.tags.join(', ').length + 48
}

/** Render the selected memories as the injected section, or `''` when empty. */
export function renderMemorySection(
  hits: readonly RecallHit[],
  policy: InjectionPolicy = DEFAULT_INJECTION_POLICY,
): string {
  const selected = selectForInjection(hits, policy)
  if (selected.length === 0) return ''
  const lines = [HEADER]
  for (const hit of selected) {
    const entry = hit.entry
    const tags = entry.tags.length > 0 ? ` (${entry.tags.join(', ')})` : ''
    lines.push(
      `- [${entry.kind}] ${entry.title}: ${entry.content.replace(/\s+/gu, ' ').trim()}${tags} — id: ${entry.id}`,
    )
  }
  return lines.join('\n')
}
