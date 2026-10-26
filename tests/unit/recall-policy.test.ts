import test from 'node:test'
import assert from 'node:assert/strict'
import type { MemoryEntry } from '../../src/cognition/schema.js'
import { rankEntries, tokenize } from '../../src/cognition/recall-policy.js'

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

test('tokenize keeps latin words and CJK bigrams', () => {
  const tokens = tokenize('Use pnpm 管理依赖')
  assert.ok(tokens.includes('pnpm'))
  assert.ok(tokens.includes('管理'))
  assert.ok(tokens.includes('依赖'))
})

test('rankEntries prefers the lexical match', () => {
  const entries = [
    entry({ id: 'mem_1', content: 'The project uses pnpm for package management.' }),
    entry({ id: 'mem_2', content: 'The user prefers dark mode.' }),
  ]
  const hits = rankEntries(entries, { text: 'package manager pnpm' })
  assert.equal(hits.length, 1)
  assert.equal(hits[0]?.entry.id, 'mem_1')
})

test('rankEntries skips archived and expired memories', () => {
  const entries = [
    entry({ id: 'mem_1', content: 'Deploy with docker compose.', status: 'archived' }),
    entry({
      id: 'mem_2',
      content: 'Deploy with docker compose.',
      expiresAt: '2020-01-01T00:00:00.000Z',
    }),
    entry({ id: 'mem_3', content: 'Deploy with docker compose.' }),
  ]
  const hits = rankEntries(entries, { text: 'deploy docker' })
  assert.deepEqual(hits.map(hit => hit.entry.id), ['mem_3'])
})

test('rankEntries with an empty query returns the most important memories', () => {
  const entries = [
    entry({ id: 'mem_1', content: 'Low importance.', importance: 0.1 }),
    entry({ id: 'mem_2', content: 'High importance.', importance: 0.9 }),
  ]
  const hits = rankEntries(entries, { text: '', limit: 1 })
  assert.equal(hits[0]?.entry.id, 'mem_2')
})

test('rankEntries filters by kind and tag', () => {
  const entries = [
    entry({ id: 'mem_1', content: 'Use pnpm.', kind: 'preference', tags: ['tooling'] }),
    entry({ id: 'mem_2', content: 'Use pnpm.', kind: 'fact', tags: ['tooling'] }),
  ]
  const hits = rankEntries(entries, { text: 'pnpm', kinds: ['preference'], tags: ['tooling'] })
  assert.deepEqual(hits.map(hit => hit.entry.id), ['mem_1'])
})
