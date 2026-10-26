import test from 'node:test'
import assert from 'node:assert/strict'
import type { MemoryEntry } from '../../src/cognition/schema.js'
import { renderMemorySection, selectForInjection } from '../../src/context/injection-policy.js'
import { DEFAULT_INJECTION_POLICY } from '../../src/context/injection-policy.js'

const STAMP = '2026-01-01T00:00:00.000Z'

function hit(id: string, kind: MemoryEntry['kind'], content: string, score: number) {
  const entry: MemoryEntry = {
    id,
    kind,
    scope: 'global',
    title: content.slice(0, 30),
    content,
    tags: [],
    evidence: [{ source: 'user', at: STAMP }],
    confidence: 0.9,
    importance: 0.5,
    status: 'active',
    createdAt: STAMP,
    updatedAt: STAMP,
    lastAccessedAt: STAMP,
    accessCount: 0,
    version: 1,
  }
  return { entry, score, matchedTerms: [] }
}

test('preferences outrank higher-scoring episodes', () => {
  const selected = selectForInjection([
    hit('mem_1', 'episode', 'A past episode.', 0.99),
    hit('mem_2', 'preference', 'Prefers tabs.', 0.3),
  ])
  assert.equal(selected[0]?.entry.id, 'mem_2')
})

test('respects the item cap and the character budget', () => {
  const long = 'x'.repeat(600)
  const selected = selectForInjection([
    hit('mem_1', 'fact', long, 0.9),
    hit('mem_2', 'fact', long, 0.8),
    hit('mem_3', 'fact', long, 0.7),
  ], { ...DEFAULT_INJECTION_POLICY, budgetChars: 700, maxItems: 2 })
  assert.equal(selected.length, 1)
})

test('renders an empty section for no hits', () => {
  assert.equal(renderMemorySection([]), '')
})
