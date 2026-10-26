import test from 'node:test'
import assert from 'node:assert/strict'
import type { MemoryEntry } from '../../src/cognition/schema.js'
import { withDefaults } from '../../src/cognition/schema.js'
import { mergeEntries, planSave, textSimilarity } from '../../src/cognition/save-policy.js'
import { DEFAULT_SAVE_POLICY } from '../../src/cognition/save-policy.js'

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

test('textSimilarity matches paraphrases and separates unrelated text', () => {
  const a = 'The project uses pnpm for package management'
  const b = 'This project uses pnpm as its package manager'
  assert.ok(textSimilarity(a, b) > 0.4)
  assert.equal(textSimilarity(a, 'The user prefers dark mode'), 0)
})

test('planSave rejects low-confidence memories', () => {
  const candidate = withDefaults({ content: 'Maybe the build uses Vite.' })
  const plan = planSave(candidate, 0.2, [], DEFAULT_SAVE_POLICY)
  assert.equal(plan.action, 'reject')
})

test('planSave inserts when nothing similar exists', () => {
  const candidate = withDefaults({ content: 'The test command is pnpm test.' })
  const plan = planSave(candidate, 0.8, [entry({ id: 'mem_1', content: 'The user prefers dark mode.' })])
  assert.equal(plan.action, 'insert')
})

test('planSave merges near-duplicates', () => {
  const existing = entry({ id: 'mem_1', content: 'The project uses pnpm for package management.' })
  const candidate = withDefaults({ content: 'This project uses pnpm as the package manager.' })
  const plan = planSave(candidate, 0.8, [existing])
  assert.equal(plan.action, 'merge')
  assert.equal(plan.targetId, 'mem_1')
})

test('planSave supersedes a structured contradiction', () => {
  const existing = entry({
    id: 'mem_1',
    content: 'The package manager is npm.',
    subject: 'package-manager',
    predicate: 'is',
    value: 'npm',
  })
  const candidate = withDefaults({
    content: 'The package manager is pnpm.',
    subject: 'package-manager',
    predicate: 'is',
    value: 'pnpm',
  })
  const plan = planSave(candidate, 0.8, [existing])
  assert.equal(plan.action, 'supersede')
  assert.equal(plan.targetId, 'mem_1')
  assert.equal(plan.conflicts.length, 1)
})

test('mergeEntries unions tags and keeps the longer content', () => {
  const existing = entry({ id: 'mem_1', content: 'Short.', tags: ['a'], confidence: 0.6 })
  const candidate = withDefaults({ content: 'This is the much longer statement.', tags: ['b'] })
  const merged = mergeEntries(existing, candidate, 0.9, [{ source: 'user', at: STAMP }], new Date(STAMP))
  assert.equal(merged.content, 'This is the much longer statement.')
  assert.deepEqual(merged.tags, ['a', 'b'])
  assert.equal(merged.version, 2)
  assert.equal(merged.confidence, 0.9)
})

test('does not merge similar memories from different project paths', () => {
  const existing = entry({
    id: 'mem_project_a',
    content: 'The project uses pnpm for package management.',
    scope: 'project',
    projectPath: 'D:\\work\\project-a',
  })

  const candidate = withDefaults({
    content: 'The project uses pnpm for package management.',
    scope: 'project',
    projectPath: 'D:\\work\\project-b',
  })

  const plan = planSave(candidate, 0.9, [existing])

  assert.equal(plan.action, 'insert')
})

test('does not supersede a structured contradiction from another project', () => {
  const existing = entry({
    id: 'mem_project_a',
    content: 'The package manager is npm.',
    scope: 'project',
    projectPath: 'D:\\work\\project-a',
    subject: 'package-manager',
    predicate: 'is',
    value: 'npm',
  })

  const candidate = withDefaults({
    content: 'The package manager is pnpm.',
    scope: 'project',
    projectPath: 'D:\\work\\project-b',
    subject: 'package-manager',
    predicate: 'is',
    value: 'pnpm',
  })

  const plan = planSave(candidate, 0.9, [existing])

  assert.equal(plan.action, 'insert')
  assert.equal(plan.conflicts.length, 0)
})
