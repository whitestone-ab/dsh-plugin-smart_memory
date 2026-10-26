import test from 'node:test'
import assert from 'node:assert/strict'
import type { MemoryEntry, MemoryEvidence } from '../../src/cognition/schema.js'
import { withDefaults } from '../../src/cognition/schema.js'
import { mergeEntries } from '../../src/cognition/save-policy.js'

const STAMP = '2026-01-01T00:00:00.000Z'

function entry(overrides: Partial<MemoryEntry> & Pick<MemoryEntry, 'id' | 'content'>): MemoryEntry {
  return {
    kind: 'fact',
    scope: 'project',
    title: overrides.content.slice(0, 40),
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
    ...overrides,
  }
}

function isoAt(seconds: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString()
}

function ev(
  seconds: number,
  quote: string,
  source: MemoryEvidence['source'] = 'user',
): MemoryEvidence {
  return { source, at: isoAt(seconds), quote }
}

test('mergeEntries keeps the oldest 5 and newest 15 when evidence exceeds 20', () => {
  const existingEvidence = Array.from({ length: 10 }, (_, i) => ev(i, `quote-${i}`))
  const incomingEvidence = Array.from({ length: 15 }, (_, i) => ev(10 + i, `quote-${10 + i}`))

  const existing = entry({ id: 'mem_1', content: 'Same statement', evidence: existingEvidence })
  const candidate = withDefaults({ content: 'Same statement' })
  const merged = mergeEntries(existing, candidate, 0.9, incomingEvidence, new Date(STAMP))

  assert.equal(merged.evidence.length, 20)
  const quotes = merged.evidence.map(item => item.quote)

  for (let i = 0; i < 5; i += 1) {
    assert.ok(quotes.includes(`quote-${i}`), `missing oldest quote-${i}`)
  }
  for (let i = 10; i < 25; i += 1) {
    assert.ok(quotes.includes(`quote-${i}`), `missing newest quote-${i}`)
  }
  for (let i = 5; i < 10; i += 1) {
    assert.ok(!quotes.includes(`quote-${i}`), `middle quote-${i} should have been dropped`)
  }
})

test('mergeEntries sorts evidence by at ascending with a stable tiebreak', () => {
  const existingEvidence: MemoryEvidence[] = [
    ev(30, 'c'),
    ev(10, 'a'),
    ev(20, 'b2', 'assistant'),
    ev(20, 'b1', 'user'),
  ]
  const existing = entry({ id: 'mem_1', content: 'Same statement', evidence: existingEvidence })
  const candidate = withDefaults({ content: 'Same statement' })
  const merged = mergeEntries(existing, candidate, 0.9, [], new Date(STAMP))

  assert.deepEqual(merged.evidence.map(item => item.quote), ['a', 'b2', 'b1', 'c'])
})

test('mergeEntries keeps every evidence item when under the cap', () => {
  const existingEvidence = Array.from({ length: 8 }, (_, i) => ev(i, `q-${i}`))
  const incomingEvidence = Array.from({ length: 5 }, (_, i) => ev(20 + i, `n-${i}`))

  const existing = entry({ id: 'mem_1', content: 'Same statement', evidence: existingEvidence })
  const candidate = withDefaults({ content: 'Same statement' })
  const merged = mergeEntries(existing, candidate, 0.9, incomingEvidence, new Date(STAMP))

  assert.equal(merged.evidence.length, 13)
  const ats = merged.evidence.map(item => item.at)
  assert.deepEqual(ats, [...ats].sort())
})

test('mergeEntries deduplicates identical evidence triples', () => {
  const duplicate = ev(5, 'same')
  const existing = entry({
    id: 'mem_1',
    content: 'Same statement',
    evidence: [duplicate, ev(1, 'first')],
  })
  const candidate = withDefaults({ content: 'Same statement' })
  const merged = mergeEntries(existing, candidate, 0.9, [duplicate, ev(10, 'second')], new Date(STAMP))

  assert.equal(merged.evidence.length, 3)
  assert.equal(merged.evidence.filter(item => item.quote === 'same').length, 1)
  assert.deepEqual(merged.evidence.map(item => item.quote), ['first', 'same', 'second'])
})
